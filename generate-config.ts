import {NETWORK, NetworkSpecificConfig} from "./src/types";
import defaultConfig from "./configs/defaults";

import {ethers} from 'ethers'
import {BigNumber} from 'bignumber.js'
import * as fs from "fs";
import {formatNumber} from "./src/lib";
import prompts = require("prompts");
import {gatherInfoFromUser} from "./src/prompts";
import {omit} from "lodash";

function printIntro(){
    console.log("Welcome to the moonwell market adjuster!")
    console.log("This handy wizard will help you generate a config file that can be consumed by the `generate-proposal` tool.")
    console.log("You'll answer a series of questions below which should handle all the heavy lifting/hard work for you!")
    console.log()
}

async function fetchSafetyModuleInfo(
    config: NetworkSpecificConfig,
    provider: ethers.providers.JsonRpcProvider,
    blockTag: ethers.CallOverrides,
    govTokenPrice: BigNumber
){
    const safetyModuleContract = config.contracts.SAFETY_MODULE.contract.connect(provider)
    const totalSupplyEthersBignum = await safetyModuleContract.totalSupply(blockTag)
    const totalStaked = new BigNumber(totalSupplyEthersBignum.toString()).shiftedBy(-18)
    const assetConfig = await safetyModuleContract.assets(safetyModuleContract.address, blockTag)

    // Get the emission info
    const emissionsPerSecond = new BigNumber(assetConfig.emissionPerSecond.toString()).shiftedBy(-18)
    const lastUpdateTimestamp = new BigNumber(assetConfig.lastUpdateTimestamp.toString()).toNumber()

    // Calculate emissions APR
    const emissionsPerYear = emissionsPerSecond.times(86400).times(365)
    const emissionAPR = totalStaked.plus(emissionsPerYear).div(totalStaked).minus(1).times(100)

    const emissions = {
        emissionsPerSecond, lastUpdateTimestamp, emissionAPR
    }

    return {
        totalStaked: totalStaked,
        stakedTVL: totalStaked.times(govTokenPrice),
        govTokenPrice,
        emissions
    }
}

async function fetchDexInfo(config: NetworkSpecificConfig, provider: ethers.providers.JsonRpcProvider, blockTag: ethers.CallOverrides, network: NETWORK) {
    const oracleContract = config.contracts.ORACLE.contract.connect(provider)
    const oraclePrice = await oracleContract.getUnderlyingPrice(config.nativeAsset.mTokenAddress, blockTag)
    const nativePrice = new BigNumber(oraclePrice.toString()).div(1e18)

    // console.log("Price:", nativePrice.toFixed())

    const pairContract = new ethers.Contract(config.govTokenUniPoolAddress, require('./abi/UniPair.json'), provider);
    let nativeAssetTotal, govTokenTotal
    // Stellaswap and Solarbeam have differnet configs and put the "core" asset in different orders :(
    if (network === NETWORK.MOONBEAM){
        let [WELLReserve, GLMRReserve, _blockTimestampLast] = await pairContract.getReserves()
        nativeAssetTotal = new BigNumber(GLMRReserve.toString()).div(1e18)
        govTokenTotal = new BigNumber(WELLReserve.toString()).div(1e18)

        // console.log({WELLPrice: govTokenPrice.toFixed()})
    } else {
        let [MOVRReserve, MFAMReserve, _blockTimestampLast] = await pairContract.getReserves()
        nativeAssetTotal = new BigNumber(MOVRReserve.toString()).div(1e18)
        govTokenTotal = new BigNumber(MFAMReserve.toString()).div(1e18)
    }
    const govTokenPrice = nativeAssetTotal.div(govTokenTotal).times(nativePrice)

    let poolID, poolInfo, currentPoolRewardInfo, nextFreeSlot, currentConfig
    if (network === NETWORK.MOONBEAM){
        poolID = 15
        poolInfo = await config.contracts.DEX_REWARDER.contract.connect(provider).poolInfo(poolID)
        nextFreeSlot = poolInfo.allocPoint.toNumber()
        currentConfig = await config.contracts.DEX_REWARDER.contract.connect(provider).poolRewardInfo(poolID, poolInfo.allocPoint.sub(1))

    } else if (network === NETWORK.MOONRIVER){
        poolID = 11
        poolInfo = await config.contracts.DEX_REWARDER.contract.connect(provider).poolInfo(poolID)

        // Go search for the next reward slot
        nextFreeSlot = 20
        for (;;){
            try {
                currentConfig = await config.contracts.DEX_REWARDER.contract.connect(provider).poolRewardInfo(poolID, nextFreeSlot + 1)
                nextFreeSlot += 1
            } catch (e){
                // Increment one more time to the next empty slot
                nextFreeSlot += 1
                break
            }
        }

    } else {
        throw new Error("Unknown network " + network)
    }

    currentPoolRewardInfo = {
        startTimestamp: currentConfig.startTimestamp.toNumber(),
        endTimestamp: currentConfig.endTimestamp.toNumber(),
        rewardPerSec: new BigNumber(currentConfig.rewardPerSec.toString()).shiftedBy(-18),
    }

    const poolTVL = nativePrice.times(nativeAssetTotal).plus(
        govTokenPrice.times(govTokenTotal)
    )

    const emissionsPerSec = new BigNumber(currentPoolRewardInfo.rewardPerSec)
    const emissionsPerDay = emissionsPerSec.times(86400)
    const emissionsPerYear = emissionsPerDay.times(365)

    const currentEmissionGrowth = emissionsPerYear.times(govTokenPrice)
    const currentPoolAPR = poolTVL.plus(currentEmissionGrowth).div(poolTVL).minus(1).times(100)

    return {
        govTokenTotal,
        nativeAssetTotal,
        govTokenPrice,
        nextFreeSlot,
        emissionsPerYear,
        poolTVL,
        currentPoolAPR,
        currentPoolRewardInfo
    }
}

async function generateConfig(){
    printIntro()

    const responses = await gatherInfoFromUser()
    // const responses = {
    //     name: 'ok',
    //     network: 'Moonbeam',
    //     mipNumber: 4,
    //     componentSplits: defaultConfig[NETWORK.MOONBEAM].defaultSplits,
    //     emissionAmounts: defaultConfig[NETWORK.MOONBEAM].defaultGrantAmounts
    // }
    // const responses = {
    //     name: 'ok',
    //     network: 'Moonriver',
    //     mipNumber: 5,
    //     componentSplits: defaultConfig[NETWORK.MOONRIVER].defaultSplits,
    //     emissionAmounts: defaultConfig[NETWORK.MOONRIVER].defaultGrantAmounts
    // }
    // console.log({responses})

    const currentNetwork = responses.network as NETWORK

    const config = defaultConfig[currentNetwork]

    console.log(`Awesome, thanks for the info. Fetching some data from the ${config.networkName} network`)

    const provider = new ethers.providers.JsonRpcProvider(config.rpc)

    const latestBlock = await provider.getBlock('latest')

    // Used by provider calls
    const blockTag: ethers.CallOverrides = {blockTag: latestBlock.number}

    const dexInfo = await fetchDexInfo(
        config, provider, blockTag, currentNetwork
    )

    const safetyModuleInfo = await fetchSafetyModuleInfo(
        config, provider, blockTag, dexInfo.govTokenPrice,
    )

    // const totalSMEmissions =

    console.log('Staked:',
        formatNumber(
            safetyModuleInfo.totalStaked.toFixed(4)
        ),
        config.govTokenName
    )

    console.log(`Latest block on ${config.networkName}: ${latestBlock.number}`)

    const mipConfig = {
        _meta: {
            generatedAt: new Date().toISOString(),
            generatorVersion: require('./package.json').version,
        },
        snapshotBlock: latestBlock.number,
        safetyModuleInfo,
        dexInfo,
        config: {
            daysPerRewardCycle: defaultConfig.daysPerRewardCycle,
            ...omit(config, ['defaultGrantAmounts', 'defaultSplits'])
        },
        responses
    }

    const serializedConfig = JSON.stringify(mipConfig, null, 2)

    const configPath = `./configs/MIP-${mipConfig.responses.mipNumber}.json`

    fs.writeFileSync(configPath, serializedConfig)

    console.log(`Wonderful, we've just generated ${configPath}. You can use the \`generate-proposal\` function to generate a market adjustment proposal from this config.`)
    console.log("Optionally, we can run it for you right now if you like")
    const shouldGenerateProposal = await prompts({
        type: 'confirm',
        name: 'value',
        message: 'Would you like to generate a proposal now?',
        initial: true
    })
    if (shouldGenerateProposal.value){
        // Go kick off proposal generator
        await require('./generate-proposal').default(configPath)
    }
}

if (require.main === module) {
    // noinspection JSIgnoredPromiseFromCall
    generateConfig()
}
