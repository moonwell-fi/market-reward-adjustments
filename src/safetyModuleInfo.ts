import {NetworkSpecificConfig} from "./types";
import {ethers} from "ethers";
import {BigNumber} from "bignumber.js";
import {formatNumber, ONE_DAY_IN_SECONDS, ONE_YEAR_IN_DAYS} from "./lib";
import chalk from "chalk";

export async function fetchSafetyModuleInfo(
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

    const stakedTVL = totalStaked.times(govTokenPrice)

    console.log(`  ${chalk.yellowBright("Safety Module")}:`)
    console.log(`    Total Staked: ${chalk.yellowBright(formatNumber(totalStaked) + ' ' + config.govTokenName)}`)
    console.log(`    Staked TVL: ${chalk.greenBright("$" + formatNumber(stakedTVL))}`)

    return {
        totalStaked,
        stakedTVL,
        govTokenPrice,
        emissions
    }
}