import {NetworkSpecificConfig, REWARD_TYPE} from "./types";
import {ethers} from "ethers";
import chalk from "chalk";
import {BigNumber} from "bignumber.js";
import {getDeployArtifact} from "@moonwell-fi/moonwell.js";
import {formatNumber} from "./lib";
import {sortBy} from "lodash";

export async function fetchMarketInfo(config: NetworkSpecificConfig, provider: ethers.providers.JsonRpcProvider, blockTag: ethers.CallOverrides) {
    const oracle = config.contracts.ORACLE.contract.connect(provider)
    const assetData: {[key:string]: any} = {}

    const comptroller = config.contracts.COMPTROLLER.contract.connect(provider)

    console.log(`  ${chalk.yellowBright('Market Info')}:`)

    for (const [displayTicker, market] of Object.entries(config.contracts.MARKETS)){
        // Ignore deprecated assets
        if (market.isDeprecated || displayTicker === 'BUSD.wh' || displayTicker === 'BTC.multi'){
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

        console.log(`    ${chalk.yellowBright(displayTicker)} Market`)
        console.log(`      Latest Price: ${chalk.greenBright("$" + formatNumber(price))}`)
        console.log(`      Total Supplied: ${chalk.yellowBright(formatNumber(totalSuppliedUnderlying))} ${chalk.yellowBright(displayTicker)} (${chalk.greenBright("$" + formatNumber(totalSuppliedTVL))})`)
        console.log(`      Total Borrowed: ${chalk.yellowBright(formatNumber(totalBorrows))} ${chalk.yellowBright(displayTicker)} (${chalk.greenBright("$" + formatNumber(totalBorrowedTVL))})`)
        console.log(`      Utilization: ${chalk.yellowBright(formatNumber(utilization.times(100)) + '%')}`)

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
            nativeSupplyBorrowSplit: config.defaultBorrowSupplySplit,
            govSupplyBorrowSplit: config.defaultBorrowSupplySplit,
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

        // console.log(`${leftOver}% left over due to rounding, distributing left over points to lower-TVL markets...`)

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
        govRewardSplits: rewardSplits,
        nativeRewardSplits: rewardSplits
    }
}