import prompts = require("prompts");
import {COMPONENT, NETWORK, REWARD_TYPE} from "../types";
import defaultConfig from "../../configs/defaults";
import * as fs from "fs";

import * as path from "path";
import {BigNumber} from "bignumber.js";

// Override default prompts behavior to actually exit on ctrl + c
const globalPromptOptions = {
    onCancel: (state: any) => process.exit(0)
}

export async function getName(){
    const promptResponse = await prompts([
        {
            type: 'text',
            name: 'name',
            message: 'What is your name/handle?',
            validate: name => name.length === 0 ? `Please enter something!` : true
        },
    ], globalPromptOptions)

    return promptResponse.name
}

export async function getNetwork(){
    const promptResponse = await prompts([
        {
            type: 'select',
            name: 'network',
            message: 'Which network are you adjusting rewards for?',
            choices: [
                { value: NETWORK.MOONBEAM, title: 'Moonbeam', description: 'The Moonbeam deployment of Moonwell is named Moonwell Artemis' },
                { value: NETWORK.MOONRIVER, title: 'Moonriver', description: 'The Moonriver deployment of Moonwell is named Moonwell Apollo' },
            ],
            initial: 0
        },
    ], globalPromptOptions)

    return promptResponse.network
}

export async function getMIPNumber(){
    const promptResponse = await prompts([
        {
            type: 'number',
            name: 'mip',
            message: 'What is the MIP number of this proposal?',
            validate: (mipNumber) => {
                // Ugh node why
                if (fs.existsSync(path.resolve(__dirname, `../../configs/MIP-${mipNumber}.ts`))){
                    return `MIP-${mipNumber}.ts already exists! Try again or delete the file`
                }
                return mipNumber.length === 0 ? `Please enter something!` : true
            }
        },
    ], globalPromptOptions)

    return promptResponse.mip
}

export async function getComponentSplits(defaultSplits: any){
    const promptResponse = await prompts([
        {
            type: 'toggle',
            name: 'useDefaultSplits',
            initial: true,
            message: 'Do you want to use these default splits?',
            active: 'yes',
            inactive: 'no'
        },
    ], globalPromptOptions)

    if (promptResponse.useDefaultSplits){
        return defaultSplits
    } else {
        console.log()
        console.log("Please enter the desired splits as a decimal (ex. for 33% use 0.33). All 3 combined *must* add up to 1!")
        const splitResponse = await prompts([
            {
                type: 'number',
                name: COMPONENT.ALL_MARKETS,
                float: true,
                initial: defaultSplits[COMPONENT.ALL_MARKETS],
                message: 'What share should the Market Rewards get?',
            },
            {
                type: 'number',
                name: COMPONENT.SAFETY_MODULE,
                float: true,
                initial: defaultSplits[COMPONENT.SAFETY_MODULE],
                message: 'What share should the Safety Module get?',
            },
            {
                type: 'number',
                name: COMPONENT.DEX_REWARDER,
                float: true,
                initial: defaultSplits[COMPONENT.DEX_REWARDER],
                message: 'What share should the DEX Rewarder get?',
            },
        ], globalPromptOptions)

        if (splitResponse.DEX_REWARDER + splitResponse.ALL_MARKETS + splitResponse.SAFETY_MODULE !== 1){
            console.log(`The totals don't equal 1! ${splitResponse.DEX_REWARDER} + ${splitResponse.ALL_MARKETS} + ${splitResponse.SAFETY_MODULE} !== 1`)
            console.log("Please try again")
            process.exit(1)
        }

        return splitResponse
    }
}

export async function getEmissionSplits(config: any, currentNetwork: NETWORK){
    const promptResponse = await prompts([
        {
            type: 'number',
            name: 'govTokenAmount',
            initial: defaultConfig[currentNetwork].defaultGrantAmounts[REWARD_TYPE.GOV_TOKEN],
            min: 0,
            message: `How many ${config.govTokenName} should be emitted over the next ${defaultConfig.daysPerRewardCycle} days? Default: ${defaultConfig[currentNetwork].defaultGrantAmounts[REWARD_TYPE.GOV_TOKEN].toLocaleString()}`,
            // validate(num) {
            //     return !Number.isNaN(parseFloat(num))
            // }
        },
        {
            type: 'number',
            float: true,
            name: 'nativeTokenAmount',
            initial: defaultConfig[currentNetwork].defaultGrantAmounts[REWARD_TYPE.NATIVE_TOKEN],
            min: 0,
            message: `How many ${config.nativeTokenName} should be emitted over the next ${defaultConfig.daysPerRewardCycle} days? Default: ${defaultConfig[currentNetwork].defaultGrantAmounts[REWARD_TYPE.NATIVE_TOKEN].toLocaleString()}`,
            // validate: (num) => !Number.isNaN(num)
        },
    ], globalPromptOptions)

    return {govTokens: promptResponse.govTokenAmount, nativeTokens: promptResponse.nativeTokenAmount}
}

export async function gatherInfoFromUser(){
    const name = await getName()

    console.log()

    const network: NETWORK = await getNetwork()

    const config = defaultConfig[network]

    console.log()

    const mipNumber = await getMIPNumber()

    console.log()

    console.log({config})

    console.log(`Here is the current default reward splits for ${config.networkName}:`)
    console.log(`  - Safety Module:`, new BigNumber(config.defaultSplits[COMPONENT.SAFETY_MODULE]).times(100).toFixed() + "%", `(${config.defaultSplits[COMPONENT.SAFETY_MODULE]})`)
    console.log(`  - DEX Rewarder:`, new BigNumber(config.defaultSplits[COMPONENT.DEX_REWARDER]).times(100).toFixed() + "%", `(${config.defaultSplits[COMPONENT.DEX_REWARDER]})`)
    console.log(`  - Market Rewards:`, new BigNumber(config.defaultSplits[COMPONENT.DEX_REWARDER]).times(100).toFixed() + "%", `(${config.defaultSplits[COMPONENT.ALL_MARKETS]})`)

    console.log()

    const componentSplits = await getComponentSplits(defaultConfig[network].defaultSplits)

    console.log()

    const tokenSplits = await getEmissionSplits(config, network)

    return {name, network, mipNumber, componentSplits, tokenSplits}
}