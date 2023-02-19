import prompts from "prompts";
import {globalPromptOptions} from "./globalOptions";
import {ethers} from "ethers";
import chalk from "chalk";

export async function getSubmitterWallet(){
    const promptResponse = await prompts([
        {
            type: 'text',
            name: 'address',
            message: `What is your ${chalk.yellowBright('crypto address')}?`,
            validate(address){
                if (!ethers.utils.isAddress(address)){
                    return "Please enter a valid address!"
                }
                return true
            }
        },
    ], globalPromptOptions)

    return promptResponse.address
}