import {NETWORK, NetworkSpecificConfig} from "./src/types";
import defaultConfig from "./configs/defaults";

import {ethers} from 'ethers'
import {BigNumber} from 'bignumber.js'
import * as fs from "fs";
import prompts = require("prompts");
import {formatNumber} from "./src/lib";

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
    network: NETWORK,
){
    const safetyModuleContract = config.contracts.SAFETY_MODULE.contract.connect(provider)
    const totalSupplyEthersBignum = await safetyModuleContract.totalSupply(blockTag)
    const totalStaked = new BigNumber(totalSupplyEthersBignum.toString())
    const assetConfig = await safetyModuleContract.assets(safetyModuleContract.address, blockTag)

    // Get the emission info
    const emissionsPerSecond = new BigNumber(assetConfig.emissionPerSecond.toString())
    const lastUpdateTimestamp = new BigNumber(assetConfig.lastUpdateTimestamp.toString())

    // Calculate emissions APR
    const emissionsPerYear = emissionsPerSecond.times(86400).times(365)
    const emissionAPR = totalStaked.plus(emissionsPerYear).div(totalStaked).minus(1).times(100)

    const emissions = {
        emissionsPerSecond, lastUpdateTimestamp, emissionAPR
    }

    const oracleContract = config.contracts.ORACLE.contract.connect(provider)
    const oraclePrice = await oracleContract.getUnderlyingPrice(config.nativeAsset.mTokenAddress, blockTag)
    const nativePrice = new BigNumber(oraclePrice.toString()).div(1e18)

    // console.log("Price:", nativePrice.toFixed())

    const pairContract = new ethers.Contract(config.govTokenUniPoolAddress, require('./abi/UniPair.json'), provider);

    let govTokenPrice
    // Stellaswap and Solarbeam have differnet configs and put the "core" asset in different orders :(
    if (network === NETWORK.MOONBEAM){
        let [WELLReserve, GLMRReserve, _blockTimestampLast] = await pairContract.getReserves()
        GLMRReserve = new BigNumber(GLMRReserve.toString()).div(1e18)
        WELLReserve = new BigNumber(WELLReserve.toString()).div(1e18)

        govTokenPrice = GLMRReserve.div(WELLReserve).times(nativePrice)
        // console.log({WELLPrice: govTokenPrice.toFixed()})
    } else {
        let [MOVRReserve, MFAMReserve, _blockTimestampLast] = await pairContract.getReserves()
        MOVRReserve = new BigNumber(MOVRReserve.toString()).div(1e18)
        MFAMReserve = new BigNumber(MFAMReserve.toString()).div(1e18)

        govTokenPrice = MOVRReserve.div(MFAMReserve).times(nativePrice)

        // console.log({MFAMPrice: govTokenPrice.toFixed()})
    }

    const staked = new BigNumber(totalStaked.toString()).div(1e18)

    return {
        totalStaked: staked,
        stakedTVL: staked.times(govTokenPrice),
        govTokenPrice,
        emissions
    }
}

async function generateConfig(){
    printIntro()

    // const responses = await gatherInfoFromUser()
    // console.log({responses})
    const responses = {
        name: 'ij',
        network: 'Moonbeam',
        mipNumber: 3,
        componentSplits: { ALL_MARKETS: 0.3, SAFETY_MODULE: 0.42, DEX_REWARDER: 0.28 },
        emissionAmounts: { govTokens: 15625000, nativeTokens: 250000 }
    }

    const currentNetwork = responses.network as NETWORK

    const config = defaultConfig[currentNetwork]

    console.log(`Awesome, thanks for the info. Fetching some data from the ${config.networkName} network`)

    const provider = new ethers.providers.JsonRpcProvider(config.rpc)

    const latestBlock = await provider.getBlock('latest')

    // Used by provider calls
    const blockTag: ethers.CallOverrides = {blockTag: latestBlock.number}

    const safetyModuleInfo = await fetchSafetyModuleInfo(
        config,
        provider,
        blockTag,
        currentNetwork,
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
        config: {
            daysPerRewardCycle: defaultConfig.daysPerRewardCycle,
            ...config
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
