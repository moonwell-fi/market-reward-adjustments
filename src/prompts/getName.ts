import prompts from "prompts";
import {globalPromptOptions} from "./globalOptions";
import chalk from "chalk";

export async function getName(){
    const promptResponse = await prompts([
        {
            type: 'text',
            name: 'name',
            message: `What is your ${chalk.yellowBright('name/handle')}?`,
            validate: name => name.length === 0 ? `Please enter something!` : true
        },
    ], globalPromptOptions)

    return promptResponse.name
}