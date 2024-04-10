#!/usr/bin/env node

import { NETWORK } from "../src/types";
import defaultConfig from "../src/defaults";

import { ethers } from 'ethers'
import * as fs from "fs";
import { gatherInfoFromUser } from "../src/prompts";
import { omit } from "lodash";
import { OptionValues, program } from "commander";
import * as path from "path";
import chalk from "chalk";
import { fetchDexInfo } from "../src/dexInfo";
import { fetchSafetyModuleInfo } from "../src/safetyModuleInfo";
import { fetchMarketInfo } from "../src/marketInfo";

function printIntro() {
    console.log("Welcome to the moonwell market adjuster!")
    console.log("This handy wizard will help you generate a config file that can be consumed by the `generate-proposal` tool.")
    console.log("You'll answer a series of questions below which should handle all the heavy lifting/hard work for you!")
    console.log()
}

async function generateConfig(options: OptionValues) {
    printIntro()

    const responses = await gatherInfoFromUser(options)

    const currentNetwork = responses.network as NETWORK

    const config = defaultConfig[currentNetwork]

    console.log(`Awesome, thanks for the info. Fetching some data from the ${config.networkName} network...`)

    const provider = new ethers.providers.JsonRpcProvider(config.rpc)

    const snapshotBlock = await provider.getBlock(options.block)
    console.log(`  Latest ${chalk.yellowBright('Block')}: ${chalk.yellowBright(snapshotBlock.number.toLocaleString())}`)

    // Used by provider calls
    const blockTag: ethers.CallOverrides = { blockTag: snapshotBlock.number }

    const marketData = await fetchMarketInfo(
        config, provider, blockTag
    )

    const dexInfo = await fetchDexInfo(
        config, provider, blockTag, currentNetwork
    )

    const safetyModuleInfo = await fetchSafetyModuleInfo(
        config, provider, blockTag, dexInfo.govTokenPrice,
    )

    const mipConfig = {
        _meta: {
            generatedAt: new Date().toISOString(),
            generatorVersion: require('../package.json').version,
        },
        snapshotBlock: snapshotBlock.number,
        safetyModuleInfo,
        dexInfo,
        marketData,
        config: {
            daysPerRewardCycle: defaultConfig.daysPerRewardCycle,
            ...omit(config, ['defaultGrantAmounts', 'defaultSplits', 'defaultBorrowSupplySplit'])
        },
        responses
    }

    const serializedConfig = JSON.stringify(mipConfig, null, 2)

    const configPath = path.resolve(options.output, `MIP-${mipConfig.responses.mipNumber}.json`)

    fs.writeFileSync(configPath, serializedConfig)

    console.log()
    console.log(`All done! We've just generated ${chalk.yellowBright(configPath)}.`)
    console.log(`You can use the ${chalk.yellowBright('moonwell-proposal-generator')} utility to generate a proposal JSON from this config,`)
    console.log(`and can edit the config to change whatever parameters you like.`)
    console.log()
}

if (require.main === module) {
    program
        .name("Moonwell Market Adjuster Config Generator")
        .version(require('../package.json').version, '-v, --vers', 'Print the current version')
        .option('-b, --block <blockNumber>', "The block number to use for the config", "latest")
        .option('-o, --output <filePath>', "The dir to use to write out the config, named `MIP-XX.json`", '')

    program.parse(process.argv)

    const options = program.opts()

    generateConfig(options).catch(e => {
        console.error(e)
        process.exit(1)
    })
}
