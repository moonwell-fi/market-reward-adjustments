import {NETWORK, NetworkSpecificConfig} from "./types";
import {ethers} from "ethers";
import {BigNumber} from "bignumber.js";
import {formatNumber, ONE_DAY_IN_SECONDS, ONE_YEAR_IN_DAYS} from "./lib";
import chalk from "chalk";

export async function fetchDexInfo(config: NetworkSpecificConfig, provider: ethers.providers.JsonRpcProvider, blockTag: ethers.CallOverrides, network: NETWORK) {
    const oracleContract = config.contracts.ORACLE.contract.connect(provider)
    const oraclePrice = await oracleContract.getUnderlyingPrice(config.nativeAsset.mTokenAddress, blockTag)
    const nativePrice = new BigNumber(oraclePrice.toString()).div(1e18)

    const pairContract = new ethers.Contract(config.govTokenUniPoolAddress, require('../src/abi/UniPair.json'), provider);
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

    const poolInfo = await config.contracts.DEX_REWARDER.contract.connect(provider).poolInfo(config.dexPoolID)

    let currentPoolRewardInfo, nextFreeSlot, currentConfig
    if (network === NETWORK.MOONBEAM){
        nextFreeSlot = poolInfo.allocPoint.toNumber()
        currentConfig = await config.contracts.DEX_REWARDER.contract.connect(provider).poolRewardInfo(config.dexPoolID, poolInfo.allocPoint.sub(1))

    } else if (network === NETWORK.MOONRIVER){
        // Go search for the next reward slot
        nextFreeSlot = 20
        for (;;){
            try {
                currentConfig = await config.contracts.DEX_REWARDER.contract.connect(provider).poolRewardInfo(config.dexPoolID, nextFreeSlot + 1)
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

    console.log(`  ${chalk.yellowBright('Dex Rewarder')}:`)
    console.log(`    ${config.govTokenName} Side: ${chalk.yellowBright(formatNumber(govTokenTotal) + " " + config.govTokenName)}`)
    console.log(`    ${config.nativeTokenName} Side: ${chalk.yellowBright(formatNumber(nativeAssetTotal) + " " + config.nativeTokenName)}`)
    console.log(`    ${config.govTokenName} Price: ${chalk.greenBright('$' + formatNumber(govTokenPrice, 6))}`)
    console.log(`    LP TVL: ${chalk.greenBright("$" + formatNumber(poolTVL))}`)

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
