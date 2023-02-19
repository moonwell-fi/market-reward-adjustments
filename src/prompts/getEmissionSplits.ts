import prompts from "prompts";
import {globalPromptOptions} from "./globalOptions";
import {NETWORK, REWARD_TYPE} from "../types";
import defaultConfig from "../defaults";

export async function getEmissionSplits(config: any, currentNetwork: NETWORK){
    const govResponse = await prompts([
        {
            type: 'number',
            name: 'govTokenAmount',
            initial: defaultConfig[currentNetwork].defaultGrantAmounts[REWARD_TYPE.GOV_TOKEN],
            min: 0,
            message: `How many ${config.govTokenName} should be emitted over the next ${defaultConfig.daysPerRewardCycle} days? Default: ${defaultConfig[currentNetwork].defaultGrantAmounts[REWARD_TYPE.GOV_TOKEN].toLocaleString()}`,
        },
    ], globalPromptOptions)

    console.log()

    const nativeResponse = await prompts([
        {
            type: 'number',
            float: true,
            name: 'nativeTokenAmount',
            initial: defaultConfig[currentNetwork].defaultGrantAmounts[REWARD_TYPE.NATIVE_TOKEN],
            min: 0,
            message: `How many ${config.nativeTokenName} should be emitted over the next ${defaultConfig.daysPerRewardCycle} days? Default: ${defaultConfig[currentNetwork].defaultGrantAmounts[REWARD_TYPE.NATIVE_TOKEN].toLocaleString()}`,
        },
    ], globalPromptOptions)

    return {[REWARD_TYPE.GOV_TOKEN]: govResponse.govTokenAmount, [REWARD_TYPE.NATIVE_TOKEN]: nativeResponse.nativeTokenAmount}
}