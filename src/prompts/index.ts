import {COMPONENT, NETWORK} from "../types";
import defaultConfig from "../defaults";

import {BigNumber} from "bignumber.js";
import {getName} from "./getName";
import {getSubmitterWallet} from "./getSubmitterWallet";
import {getNetwork} from "./getNetwork";
import {getMIPNumber} from "./getMIPNumber";
import {getComponentSplits} from "./getComponentSplits";
import {getEmissionSplits} from "./getEmissionSplits";
import {OptionValues} from "commander";
import chalk from "chalk";

export async function gatherInfoFromUser(options: OptionValues){
    const name = await getName()

    console.log()

    const submitterWallet = await getSubmitterWallet()

    console.log()

    const network: NETWORK = await getNetwork()

    const config = defaultConfig[network]

    console.log()

    const mipNumber = await getMIPNumber(options)

    console.log()

    console.log(`Here is the ${chalk.yellowBright('current default')} reward splits for ${config.networkName}:`)
    console.log(chalk.yellowBright(`     Safety Module`) + `: ` + chalk.greenBright(`${new BigNumber(config.defaultSplits[COMPONENT.SAFETY_MODULE]).times(100).toFixed()}% (${config.defaultSplits[COMPONENT.SAFETY_MODULE]})`))
    console.log(chalk.yellowBright(`      DEX Rewarder`) + `: ` + chalk.greenBright(`${new BigNumber(config.defaultSplits[COMPONENT.DEX_REWARDER]).times(100).toFixed()}% (${config.defaultSplits[COMPONENT.DEX_REWARDER]})`))
    console.log(chalk.yellowBright(`    Market Rewards`) + `: ` + chalk.greenBright(`${new BigNumber(config.defaultSplits[COMPONENT.ALL_MARKETS]).times(100).toFixed()}% (${config.defaultSplits[COMPONENT.ALL_MARKETS]})`))

    console.log()

    const componentSplits = await getComponentSplits(defaultConfig[network].defaultSplits)

    console.log()

    const emissionAmounts = await getEmissionSplits(config, network)

    console.log()

    return {
        name,
        network,
        mipNumber,
        componentSplits,
        emissionAmounts,
        submitterWallet
    }
}