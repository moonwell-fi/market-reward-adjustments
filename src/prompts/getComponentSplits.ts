import prompts from "prompts";
import {globalPromptOptions} from "./globalOptions";
import {COMPONENT} from "../types";

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