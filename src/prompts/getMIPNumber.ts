import prompts from "prompts";
import {globalPromptOptions} from "./globalOptions";
import fs from "fs";
import path from "path";
import {OptionValues} from "commander";
import chalk from "chalk";

export async function getMIPNumber(options: OptionValues){
    const promptResponse = await prompts([
        {
            type: 'number',
            name: 'mip',
            message: `What is the ${chalk.yellowBright('MIP number')} of this proposal?`,
            validate: (mipNumber) => {

                const configPath = path.resolve(options.output, `MIP-${mipNumber}.json`)
                // Ugh node why
                if (fs.existsSync(configPath)){
                    return `MIP-${mipNumber}.ts already exists! Try again or delete the file`
                }
                return mipNumber.length === 0 ? `Please enter something!` : true
            }
        },
    ], globalPromptOptions)

    return promptResponse.mip
}