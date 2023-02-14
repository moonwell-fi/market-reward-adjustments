import fs from "fs";
import path from "path";
import {split, template} from "lodash";
import {BigNumber} from "bignumber.js";
import {formatNumber} from "./src/lib";
import {COMPONENT, NetworkSpecificConfig, REWARD_TYPE} from "./src/types";

function printIntro(){
    console.log("Welcome to the proposal generator!")
    console.log("This tool reads in a config from the \`generate-config\` tool and produces a proposal and corresponding JSON needed to submit this market adjustment on-chain.")
    console.log()
}

function loadTemplate(templateName: string){
    return fs.readFileSync(`./templates/${templateName}`, {encoding:'utf8', flag:'r'})
}

export function currentGovRewardSpeeds(config: any, emissionsPerSecond: BigNumber){
    const ONE_DAY = 86400
    return [
        formatNumber(
            emissionsPerSecond, 4
        ) + " " + config.govTokenName + " / second",
        formatNumber(
            emissionsPerSecond.times(ONE_DAY), 2
        ) + " " + config.govTokenName + " / day",
        formatNumber(
            emissionsPerSecond.times(ONE_DAY).times(config.daysPerRewardCycle), 2
        ) + " " + config.govTokenName + " / reward cycle (" + config.daysPerRewardCycle + " days)",
    ].map(i => '\n        - `' + i + '`').join('')
}

export function proposedGovRewardSpeeds(config: any, newEmissionsPerSecond: BigNumber){
    const ONE_DAY = 86400
    return [
        formatNumber(
            newEmissionsPerSecond, 4
        ) + " " + config.govTokenName + " / second",
        formatNumber(
            newEmissionsPerSecond.times(ONE_DAY), 2
        ) + " " + config.govTokenName + " / day",
        formatNumber(
            newEmissionsPerSecond.times(ONE_DAY).times(config.daysPerRewardCycle), 2
        ) + " " + config.govTokenName + " / reward cycle (" + config.daysPerRewardCycle + " days)",
    ].map(i => '\n        - `' + i + '`').join('')
}

function sanityChecks(mipData: any){
    // Sanity check the splits
    if (
        mipData.responses.componentSplits[COMPONENT.SAFETY_MODULE] +
        mipData.responses.componentSplits[COMPONENT.DEX_REWARDER] +
        mipData.responses.componentSplits[COMPONENT.ALL_MARKETS]
        !== 1
    ){
        throw new Error("Splits don't equal 1!")
    }
}

export default async function generateProposal(mipPath: string){
    const mipPathNormalized = path.resolve(__dirname, mipPath)
    if (fs.existsSync(mipPathNormalized)){
        const rawConfigData = fs.readFileSync(mipPathNormalized, {encoding:'utf8', flag:'r'})
        console.log(rawConfigData)
        const mipData = JSON.parse(rawConfigData)

        sanityChecks(mipData)

        const govTokenAmountToEmit = mipData.responses.emissionAmounts[REWARD_TYPE.GOV_TOKEN]

        const introMarkdown = template(loadTemplate('intro2.md.ejs'))

        // Safety Module stuff
        const safetyModuleMarkdown = template(loadTemplate('safety-module.md.ejs'))

        const smSplitPercentage = mipData.responses.componentSplits[COMPONENT.SAFETY_MODULE]
        const smTokensToEmit = new BigNumber(govTokenAmountToEmit).times(smSplitPercentage)

        const newSMEmissionsPerSecond = smTokensToEmit.dividedBy(60 * 60 * 24 * mipData.config.daysPerRewardCycle)
        const newSMEmissionsPerYear = newSMEmissionsPerSecond.times(86400).times(365)
        const newSMEmissionAPR = new BigNumber(mipData.safetyModuleInfo.totalStaked)
            .plus(newSMEmissionsPerYear)
            .div(mipData.safetyModuleInfo.totalStaked)
            .minus(1)
            .times(100)

        // Dex rewarder stuff
        const dexRewarderMarkdown = template(loadTemplate('dex-rewarder.md.ejs'))

        const dexSplitPercentage = mipData.responses.componentSplits[COMPONENT.DEX_REWARDER]
        const dexTokensToEmit = new BigNumber(govTokenAmountToEmit).times(dexSplitPercentage)

        const newDEXEmissionsPerSecond = dexTokensToEmit.dividedBy(60 * 60 * 24 * mipData.config.daysPerRewardCycle)
        const newDEXEmissionsPerYear = newDEXEmissionsPerSecond.times(86400).times(365)
        const newDEXEmissionAPR = new BigNumber(mipData.dexInfo.poolTVL)
            .plus(newDEXEmissionsPerYear.times(mipData.dexInfo.govTokenPrice))
            .div(new BigNumber(mipData.dexInfo.poolTVL))
            .minus(1)
            .times(100)

        const proposalContent = [
            introMarkdown(mipData),
            safetyModuleMarkdown({
                BigNumber, formatNumber,
                smTokensToEmit, newSMEmissionsPerSecond, newSMEmissionAPR,
                currentGovRewardSpeeds,
                proposedGovRewardSpeeds,
                ...mipData
            }),
            dexRewarderMarkdown({
                BigNumber, formatNumber,
                dexTokensToEmit, newDEXEmissionsPerSecond, newDEXEmissionAPR,
                currentGovRewardSpeeds,
                proposedGovRewardSpeeds,
                ...mipData
            })
        ]

        console.log(proposalContent.join('\n'))
        fs.writeFileSync('proposal-content.md', proposalContent.join("\n"))
    } else {
        console.log(`Sorry, ${mipPath} doesn't seem like a path to a MIP config...`)
        process.exit(1)
    }
}

if (require.main === module) {
    (async () => {
        const argv = require('minimist')(process.argv.slice(2));

        if (argv._.length === 0){
            console.log("Please specify the path to a MIP configuration file (usually found in configs/)")
            process.exit(1)
        } else if (argv._.length > 1){
            console.log("Please only specify the path to a single MIP configuration file")
            process.exit(1)
        }

        await printIntro()
        await generateProposal(argv._[0])
    })();
}
