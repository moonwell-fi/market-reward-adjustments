import prompts from "prompts";
import {globalPromptOptions} from "./globalOptions";
import {NETWORK} from "../types";
import chalk from "chalk";

export async function getNetwork(){
    const promptResponse = await prompts([
        {
            type: 'select',
            name: 'network',
            message: `Which ${chalk.yellowBright('network')} are you adjusting rewards for?`,
            choices: [
                { value: NETWORK.MOONBEAM, title: 'Moonbeam', description: 'The Moonbeam deployment of Moonwell is named Moonwell Artemis' },
                { value: NETWORK.MOONRIVER, title: 'Moonriver', description: 'The Moonriver deployment of Moonwell is named Moonwell Apollo' },
            ],
            initial: 0
        },
    ], globalPromptOptions)

    return promptResponse.network
}