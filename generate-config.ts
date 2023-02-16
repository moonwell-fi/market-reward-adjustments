import {NETWORK, NetworkSpecificConfig, REWARD_TYPE} from "./src/types";
import defaultConfig from "./configs/defaults";

import {ethers} from 'ethers'
import {BigNumber} from 'bignumber.js'
import * as fs from "fs";
import {formatNumber} from "./src/lib";
import prompts = require("prompts");
import {gatherInfoFromUser} from "./src/prompts";
import {omit, sortBy} from "lodash";
import {getDeployArtifact, Market} from "@moonwell-fi/moonwell.js";

const ONE_YEAR_IN_DAYS = 365.25
const ONE_DAY_IN_SECONDS = 60 * 60 * 24

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
    const emissionsPerYear = emissionsPerSecond.times(ONE_DAY_IN_SECONDS).times(ONE_YEAR_IN_DAYS)
    const emissionAPR = totalStaked.plus(emissionsPerYear).div(totalStaked).minus(1).times(100)

    const emissions = {
        emissionsPerSecond, lastUpdateTimestamp, emissionAPR, emissionsPerYear
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
    const emissionsPerDay = emissionsPerSec.times(ONE_DAY_IN_SECONDS)
    const emissionsPerYear = emissionsPerDay.times(ONE_YEAR_IN_DAYS)

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

async function fetchMarketData(config: NetworkSpecificConfig, provider: ethers.providers.JsonRpcProvider, blockTag: ethers.CallOverrides) {
    const oracle = config.contracts.ORACLE.contract.connect(provider)
    const assetData: {[key:string]: any} = {}

    const comptroller = config.contracts.COMPTROLLER.contract.connect(provider)

    for (const [displayTicker, market] of Object.entries(config.contracts.MARKETS)){
        // Ignore deprecated assets
        if (market.isDeprecated || (config.networkName && displayTicker === 'BUSD.wh')){
            continue
        }

        const marketPrice = await oracle.getUnderlyingPrice(market.mTokenAddress, blockTag)

        const price = new BigNumber(marketPrice.toString()).shiftedBy(-(36 - market.digits))

        const mTokenContract = new ethers.Contract(
            market.mTokenAddress,
            getDeployArtifact('MErc20Delegator').abi,
            provider
        )

        const exchangeRate = new BigNumber(
            (await mTokenContract.exchangeRateStored(blockTag)).toString()
        ).shiftedBy(-1 * (18 + market.digits - market.mTokenDigits))

        const totalSupply = new BigNumber((await mTokenContract.totalSupply(blockTag)).toString()).shiftedBy(-8)
        const totalBorrows = new BigNumber((await mTokenContract.totalBorrows(blockTag)).toString()).shiftedBy(-1 * market.digits)

        const totalSuppliedUnderlying = totalSupply.times(exchangeRate)

        const utilization = totalBorrows.div(totalSuppliedUnderlying)

        const totalSuppliedTVL = totalSuppliedUnderlying.times(price)
        const totalBorrowedTVL = totalBorrows.times(price)

        const [
            govSupplySpeed,
            govBorrowSpeed,
            nativeSupplySpeed,
            nativeBorrowSpeed,
        ] = await Promise.all([
            comptroller.supplyRewardSpeeds(REWARD_TYPE.GOV_TOKEN, market.mTokenAddress),
            comptroller.borrowRewardSpeeds(REWARD_TYPE.GOV_TOKEN, market.mTokenAddress),
            comptroller.supplyRewardSpeeds(REWARD_TYPE.NATIVE_TOKEN, market.mTokenAddress),
            comptroller.borrowRewardSpeeds(REWARD_TYPE.NATIVE_TOKEN, market.mTokenAddress),
        ])

        assetData[displayTicker] = {
            price,
            totalSuppliedUnderlying,
            totalSuppliedTVL,
            totalBorrows,
            totalBorrowedTVL,
            utilization,
            govSupplySpeed: new BigNumber(govSupplySpeed.toString()),
            govBorrowSpeed: new BigNumber(govBorrowSpeed.toString()),
            nativeSupplySpeed: new BigNumber(nativeSupplySpeed.toString()),
            nativeBorrowSpeed: new BigNumber(nativeBorrowSpeed.toString()),
            supplyBorrowSplit: config.defaultBorrowSupplySplit,
        }
    }

    const totalTVL = Object.values(assetData).reduce((acc, assetData) => {
        return acc.plus(assetData.totalSuppliedTVL)
    }, new BigNumber(0))

    // Go add splits based on TVL, but round them down to whole percents
    const rewardSplits = Object.entries(assetData).reduce((acc: any, [key, value]) => {
        const percentBigNum = new BigNumber(
            value.totalSuppliedTVL.div(totalTVL).times(100).integerValue(BigNumber.ROUND_DOWN)
        )

        acc[key] = percentBigNum.div(100).toNumber()
        return acc
    }, {})

    // Go distribute any leftover percentage points if total points is not 100% from the lowest TVL to highest
    const totalPoints = Object.values(rewardSplits).reduce((acc: BigNumber, pct: any) => { return acc.plus(pct)  }, new BigNumber(0))
    if (!totalPoints.isEqualTo(1)){
        const leftOver = new BigNumber(1).minus(totalPoints).times(100).toNumber()
        console.log(`${leftOver}% left over due to rounding, distributing left over points to lower-TVL markets...`)
        const sorted = sortBy(Object.entries(rewardSplits), 1)
        for (let i = 0; i < leftOver; i++){
            const ticker = sorted[i][0]
            rewardSplits[ticker] = new BigNumber(rewardSplits[ticker]).plus(0.01).toNumber()
        }
    }

    const splitSums = Object.values(rewardSplits).reduce((acc: BigNumber, percent: any) => { return acc.plus(percent) }, new BigNumber(0))
    if (!splitSums.isEqualTo(1)){
        console.log({rewardSplits})
        throw new Error("Split sums for market rewards don't equal 1!")
    }

    return {
        assets: assetData,
        totalTVL,
        rewardSplits
    }
}

async function generateConfig(blockNum: string | number = 'latest'){
    printIntro()

    // const responses = await gatherInfoFromUser()
    const responses = {
        name: 'ok',
        network: 'Moonbeam',
        mipNumber: 6,
        componentSplits: defaultConfig[NETWORK.MOONBEAM].defaultSplits,
        emissionAmounts: defaultConfig[NETWORK.MOONBEAM].defaultGrantAmounts
    }
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

    const snapshotBlock = await provider.getBlock(blockNum)

    // Used by provider calls
    const blockTag: ethers.CallOverrides = {blockTag: snapshotBlock.number}

    const marketData = await fetchMarketData(
        config, provider, blockTag
    )

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

    console.log(`Using ${config.networkName} block number: ${snapshotBlock.number}`)

    const mipConfig = {
        _meta: {
            generatedAt: new Date().toISOString(),
            generatorVersion: require('./package.json').version,
        },
        snapshotBlock: snapshotBlock.number,
        safetyModuleInfo,
        dexInfo,
        marketData,
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
    console.log()

    const shouldGenerateProposal = await prompts({
        type: 'confirm',
        name: 'value',
        message: 'Would you like to generate a proposal using this config now?',
        initial: true
    })
    if (shouldGenerateProposal.value){
        // Go kick off proposal generator
        await require('./generate-proposal').default(configPath)
    }
}

if (require.main === module) {
    const argv = require('minimist')(process.argv.slice(2));

    // If a user specified
    let blockNum = 'latest'
    if (argv.b){ blockNum = argv.b }
    if (argv.block){ blockNum = argv.block }

    // noinspection JSIgnoredPromiseFromCall
    generateConfig(blockNum)
}
