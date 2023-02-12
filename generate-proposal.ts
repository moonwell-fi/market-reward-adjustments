import fs from "fs";
import path from "path";
import {template} from "lodash";
import {BigNumber} from "bignumber.js";
import {formatNumber} from "./src/lib";

function printIntro(){
    console.log("Welcome to the proposal generator!")
    console.log("This tool reads in a config from the \`generate-config\` tool and produces a proposal and corresponding JSON needed to submit this market adjustment on-chain.")
    console.log()
}

function loadTemplate(templateName: string){
    return fs.readFileSync(`./templates/${templateName}`, {encoding:'utf8', flag:'r'})
}

export default async function generateProposal(mipPath: string){
    const mipPathNormalized = path.resolve(__dirname, mipPath)
    if (fs.existsSync(mipPathNormalized)){
        const rawConfigData = fs.readFileSync(mipPathNormalized, {encoding:'utf8', flag:'r'})
        console.log(rawConfigData)
        const mipData = JSON.parse(rawConfigData)

        const introMarkdown = template(loadTemplate('intro2.md.ejs'))
        const safetyModuleMarkdown = template(loadTemplate('safety-module.md.ejs'))

        const proposalContent = [
            introMarkdown(mipData),
            safetyModuleMarkdown({ BigNumber, formatNumber,
                currentRewardSpeeds(){
                    const emissionsPerSecond = new BigNumber(mipData.safetyModuleInfo.emissions.emissionsPerSecond)
                    const ONE_DAY = 86400
                    return [
                        formatNumber(
                            emissionsPerSecond.shiftedBy(-18), 4
                        ) + " " + mipData.config.govTokenName + " / second",
                        formatNumber(
                            emissionsPerSecond.times(ONE_DAY).shiftedBy(-18), 2
                        ) + " " + mipData.config.govTokenName + " / day",
                        formatNumber(
                            emissionsPerSecond.times(ONE_DAY).times(mipData.config.daysPerRewardCycle).shiftedBy(-18), 2
                        ) + " " + mipData.config.govTokenName + " / reward cycle (" + mipData.config.daysPerRewardCycle + " days)",
                    ].map(i => '\n        - `' + i + '`').join('')
                },
                ...mipData
            }),
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
        await printIntro()
        await generateProposal('./configs/MIP-3.json')
    })();
}
