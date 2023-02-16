import fs from "fs";
import path from "path";
import {omit, template} from "lodash";
import {BigNumber} from "bignumber.js";
import {formatNumber} from "./src/lib";
import {COMPONENT, MARKET_SIDE, REWARD_TYPE} from "./src/types";

function printIntro(){
    console.log("Welcome to the proposal generator!")
    console.log("This tool reads in a config from the \`generate-config\` tool and produces a proposal and corresponding JSON needed to submit this market adjustment on-chain.")
    console.log()
}

const ONE_YEAR_IN_DAYS = 365.25
const ONE_DAY_IN_SECONDS = 60 * 60 * 24

function loadTemplate(templateName: string){
    return fs.readFileSync(`./templates/${templateName}`, {encoding:'utf8', flag:'r'})
}

export function  govRewardSpeeds(config: any, emissionsPerSecond: BigNumber){
    const ONE_DAY = 86400
    const denoms = ["second", "day", "reward cycle (" + config.daysPerRewardCycle + " days)"]
    return [
        formatNumber(emissionsPerSecond, 4),
        formatNumber(emissionsPerSecond.times(ONE_DAY), 2),
        formatNumber(emissionsPerSecond.times(ONE_DAY).times(config.daysPerRewardCycle), 2),
    ].map(
        (number, index) => {
            return `\n    - \`${number}\` ${config.govTokenName} / **${denoms[index]}**`
        }).join('')
}

// Sanity checks for the config being read in
function doSanityChecks(mipData: any){
    // Check component splits equal 100%
    const componentSums = Object.values(mipData.responses.componentSplits).reduce((acc: BigNumber, percent: any) => { return acc.plus(percent) }, new BigNumber(0))
    if (!componentSums.isEqualTo(1)){
        console.log("Component splits:\n", mipData.responses.componentSplits)
        throw new Error("Component don't equal 1!")
    }

    // Check market distribution splits equal 100%
    const splitSums = Object.values(mipData.marketData.rewardSplits).reduce((acc: BigNumber, percent: any) => { return acc.plus(percent) }, new BigNumber(0))
    if (!splitSums.isEqualTo(1)){
        console.log("Market splits:\n", mipData.marketData.rewardSplits)
        throw new Error("Market splits don't equal 1!")
    }

    Object.entries(mipData.marketData.assets).forEach(([marketTicker, marketData]: [string, any]) => {
        const supply = new BigNumber(marketData.supplyBorrowSplit[MARKET_SIDE.SUPPLY])
        const borrow = new BigNumber(marketData.supplyBorrowSplit[MARKET_SIDE.BORROW])
        if (!supply.plus(borrow).isEqualTo(1)){
            throw new Error(`The split on market ${marketTicker} doesn't add up to 1! ${JSON.stringify(marketData.supplyBorrowSplit)}`)
        }
    })
}

async function getDexCalcs(mipConfig: any, govTokenAmountToEmit: number) {
    const dexSplitPercentage = mipConfig.responses.componentSplits[COMPONENT.DEX_REWARDER]
    const dexTokensToEmit = new BigNumber(govTokenAmountToEmit).times(dexSplitPercentage)

    const newDEXEmissionsPerSecond = dexTokensToEmit.dividedBy(ONE_DAY_IN_SECONDS * mipConfig.config.daysPerRewardCycle)
    const newDEXEmissionsPerYear = newDEXEmissionsPerSecond.times(ONE_DAY_IN_SECONDS).times(ONE_YEAR_IN_DAYS)
    const newDEXEmissionAPR = new BigNumber(mipConfig.dexInfo.poolTVL)
        .plus(newDEXEmissionsPerYear.times(mipConfig.dexInfo.govTokenPrice))
        .div(new BigNumber(mipConfig.dexInfo.poolTVL))
        .minus(1)
        .times(100)
    const dexRewarderChangedPercent = new BigNumber(newDEXEmissionsPerYear)
        .div(mipConfig.dexInfo.emissionsPerYear)
        .minus(1)
        .times(100)

    let dexRewarderChangedPercentString
    if (dexRewarderChangedPercent.integerValue().isGreaterThan(0)){
        dexRewarderChangedPercentString = `to <span style="color:#5CCC4E">increase</span> emissions <span style="color:#5CCC4E">+${formatNumber(dexRewarderChangedPercent, 2)}%</span>`
    } else if (dexRewarderChangedPercent.integerValue().isLessThan(0)){
        dexRewarderChangedPercentString = `to <span style="color:red">decrease</span> emissions <span style="color:red">${formatNumber(dexRewarderChangedPercent, 2)}%</span>`
    } else {
        dexRewarderChangedPercentString = `<span style="color:#FFCF60">to keep emissions the same</span>`
    }

    return {
        dexTokensToEmit,
        newDEXEmissionsPerSecond,
        newDEXEmissionAPR,
        dexRewarderChangedPercentString,
    }
}

async function getSafetyModuleCalcs(mipConfig: any, govTokenAmountToEmit: number) {
    const smSplitPercentage = mipConfig.responses.componentSplits[COMPONENT.SAFETY_MODULE]
    const smTokensToEmit = new BigNumber(govTokenAmountToEmit).times(smSplitPercentage)

    const newSMEmissionsPerSecond = smTokensToEmit.dividedBy(60 * 60 * 24 * mipConfig.config.daysPerRewardCycle)
    const newSMEmissionsPerYear = newSMEmissionsPerSecond.times(ONE_DAY_IN_SECONDS).times(ONE_YEAR_IN_DAYS)
    const newSMEmissionAPR = new BigNumber(mipConfig.safetyModuleInfo.totalStaked)
        .plus(newSMEmissionsPerYear)
        .div(mipConfig.safetyModuleInfo.totalStaked)
        .minus(1)
        .times(100)
    const safetyModuleChangedPercent = new BigNumber(newSMEmissionsPerYear)
        .div(mipConfig.safetyModuleInfo.emissions.emissionsPerYear)
        .minus(1)
        .times(100)

    let smChangePercentString
    console.log({safetyModuleChangedPercent: safetyModuleChangedPercent.toFixed(30)})
    if (safetyModuleChangedPercent.integerValue().isGreaterThan(0)){
        smChangePercentString = `to <span style="color:#5CCC4E">increase</span> emissions <span style="color:#5CCC4E">+${formatNumber(safetyModuleChangedPercent, 2)}%</span>`
    } else if (safetyModuleChangedPercent.integerValue().isLessThan(0)){
        smChangePercentString = `to <span style="color:red">decrease</span> emissions <span style="color:red">${formatNumber(safetyModuleChangedPercent, 2)}%</span>`
    } else {
        smChangePercentString = `to <span style="color:#FFCF60">keep emissions the same</span>`
    }

    return {
        smTokensToEmit,
        newSMEmissionsPerSecond,
        newSMEmissionAPR,
        smChangePercentString,
    }
}

function getMarketCalcs(mipConfig: any, totalGovTokenAmountToEmit: BigNumber, totalNativeTokenAmountToEmit: BigNumber, individualMarketData: any, marketShare: number,) {
    const govTokensToEmit = totalGovTokenAmountToEmit.times(marketShare)
    const nativeTokensToEmit = totalNativeTokenAmountToEmit.times(marketShare)

    console.log('wtf', {totalGovTokenAmountToEmit: totalGovTokenAmountToEmit.toFixed(), marketShare, govTokensToEmit: govTokensToEmit.toFixed()})
    // ((750000000 * 0.33) / 4) / 52 / 7 == 169,986.2637362637
    // 169,520.5479452055

    const SUPPLY_PERCENT = individualMarketData.supplyBorrowSplit[MARKET_SIDE.SUPPLY]
    const BORROW_PERCENT = individualMarketData.supplyBorrowSplit[MARKET_SIDE.BORROW]

    const DAYS_PER_CYCLE = mipConfig.config.daysPerRewardCycle

    console.log("Market gets", govTokensToEmit.toFixed(4), nativeTokensToEmit.toFixed(4))

    const proposedSupplyGovTokensPerSecond = govTokensToEmit.times(SUPPLY_PERCENT).div(DAYS_PER_CYCLE).div(ONE_DAY_IN_SECONDS)
    const proposedSupplyNativeTokensPerSecond = nativeTokensToEmit.times(SUPPLY_PERCENT).div(DAYS_PER_CYCLE).div(ONE_DAY_IN_SECONDS)
    const proposedBorrowGovTokensPerSecond = govTokensToEmit.times(BORROW_PERCENT).div(DAYS_PER_CYCLE).div(ONE_DAY_IN_SECONDS)
    const proposedBorrowNativeTokensPerSecond = nativeTokensToEmit.times(BORROW_PERCENT).div(DAYS_PER_CYCLE).div(ONE_DAY_IN_SECONDS)

    return {
        // Current stuff
        currentGovSupplyPerSecond: new BigNumber(individualMarketData.govSupplySpeed).div(1e18),
        currentGovSupplyPerDay: new BigNumber(individualMarketData.govSupplySpeed).div(1e18).times(ONE_DAY_IN_SECONDS),
        currentGovSupplyPerPeriod: new BigNumber(individualMarketData.govSupplySpeed).div(1e18).times(ONE_DAY_IN_SECONDS).times(DAYS_PER_CYCLE),

        currentGovBorrowPerSecond: new BigNumber(individualMarketData.govBorrowSpeed).div(1e18),
        currentGovBorrowPerDay: new BigNumber(individualMarketData.govBorrowSpeed).div(1e18).times(ONE_DAY_IN_SECONDS),
        currentGovBorrowPerPeriod: new BigNumber(individualMarketData.govBorrowSpeed).div(1e18).times(ONE_DAY_IN_SECONDS).times(DAYS_PER_CYCLE),

        currentNativeSupplyPerSecond: new BigNumber(individualMarketData.nativeSupplySpeed).div(1e18),
        currentNativeSupplyPerDay: new BigNumber(individualMarketData.nativeSupplySpeed).div(1e18).times(ONE_DAY_IN_SECONDS),
        currentNativeSupplyPerPeriod: new BigNumber(individualMarketData.nativeSupplySpeed).div(1e18).times(ONE_DAY_IN_SECONDS).times(DAYS_PER_CYCLE),

        currentNativeBorrowPerSecond: new BigNumber(individualMarketData.nativeBorrowSpeed).div(1e18),
        currentNativeBorrowPerDay: new BigNumber(individualMarketData.nativeBorrowSpeed).div(1e18).times(ONE_DAY_IN_SECONDS),
        currentNativeBorrowPerPeriod: new BigNumber(individualMarketData.nativeBorrowSpeed).div(1e18).times(ONE_DAY_IN_SECONDS).times(DAYS_PER_CYCLE),

        // Proposed stuff
        proposedSupplyGovTokensPerSecond,
        proposedSupplyGovTokensPerDay: proposedSupplyGovTokensPerSecond.times(ONE_DAY_IN_SECONDS),
        proposedSupplyGovTokensPerPeriod: proposedSupplyGovTokensPerSecond.times(ONE_DAY_IN_SECONDS).times(DAYS_PER_CYCLE),

        proposedSupplyNativeTokensPerSecond,
        proposedSupplyNativeTokensPerDay: proposedSupplyNativeTokensPerSecond.times(ONE_DAY_IN_SECONDS),
        proposedSupplyNativeTokensPerPeriod: proposedSupplyNativeTokensPerSecond.times(ONE_DAY_IN_SECONDS).times(DAYS_PER_CYCLE),

        proposedBorrowGovTokensPerSecond,
        proposedBorrowGovTokensPerDay: proposedBorrowGovTokensPerSecond.times(ONE_DAY_IN_SECONDS),
        proposedBorrowGovTokensPerPeriod: proposedBorrowGovTokensPerSecond.times(ONE_DAY_IN_SECONDS).times(DAYS_PER_CYCLE),

        proposedBorrowNativeTokensPerSecond,
        proposedBorrowNativeTokensPerDay: proposedBorrowNativeTokensPerSecond.times(ONE_DAY_IN_SECONDS),
        proposedBorrowNativeTokensPerPeriod:proposedBorrowNativeTokensPerSecond.times(ONE_DAY_IN_SECONDS).times(DAYS_PER_CYCLE),
    }
}

export default async function generateProposal(mipPath: string){
    const mipPathNormalized = path.resolve(__dirname, mipPath)
    if (fs.existsSync(mipPathNormalized)){
        const rawConfigData = fs.readFileSync(mipPathNormalized, {encoding:'utf8', flag:'r'})
        const mipConfig = JSON.parse(rawConfigData)

        // console.log(rawConfigData)

        // Strip off "Meta" stuff
        const configToHash = JSON.stringify(omit(mipConfig, '_meta'), null, 2)
        const configHash = require('crypto').createHash('sha256').update(configToHash).digest('hex')

        console.log("Config hash:", configHash)

        doSanityChecks(mipConfig)

        const govTokenAmountToEmit = mipConfig.responses.emissionAmounts[REWARD_TYPE.GOV_TOKEN]
        const nativeTokenAmountToEmit = mipConfig.responses.emissionAmounts[REWARD_TYPE.NATIVE_TOKEN]
        const globalRenderFunctions = { BigNumber, formatNumber, govRewardSpeeds }

        // Intro stuff
        const introMarkdown = template(loadTemplate('intro.md.ejs'))

        // Safety Module stuff
        const safetyModuleMarkdown = template(loadTemplate('safety-module.md.ejs'))
        const smCalcs = await getSafetyModuleCalcs(mipConfig, govTokenAmountToEmit)

        // Dex rewarder stuff
        const dexRewarderMarkdown = template(loadTemplate('dex-rewarder.md.ejs'))
        const dexCalcs = await getDexCalcs(mipConfig, govTokenAmountToEmit)

        // Markets stuff
        const marketTopper = template(loadTemplate('market-topper.md.ejs'))
        const marketsMarkdown = template(loadTemplate('market.md.ejs'))

        // Go construct the markets section
        let marketsString = marketTopper()
        Object.entries(mipConfig.marketData.assets).forEach(([ticker, individualMarketData]) => {
            const marketSplit = mipConfig.responses.componentSplits[COMPONENT.ALL_MARKETS]
            console.log({govTokenAmountToEmit: govTokenAmountToEmit.toFixed()})
            const marketGovTokensToEmit = new BigNumber(govTokenAmountToEmit).times(marketSplit)

            // Native tokens don't get split into anything else
            const marketNativeTokensToEmit = new BigNumber(nativeTokenAmountToEmit)

            const marketCalcs = getMarketCalcs(
                mipConfig,
                marketGovTokensToEmit,
                marketNativeTokensToEmit,
                individualMarketData,
                mipConfig.marketData.rewardSplits[ticker],
            )
            marketsString += marketsMarkdown({
                ticker, individualMarketData, marketCalcs,
                ...globalRenderFunctions, ...mipConfig
            })
        })

        // Definitions section
        const definitionMarkdown = mipConfig.config.networkName === 'Moonbeam' ?
            template(loadTemplate('definitions.artemis.md.ejs')) :
            template(loadTemplate('definitions.apollo.md.ejs'))

        // Construct the proposal
        const proposalContent = [
            introMarkdown(mipConfig),
            safetyModuleMarkdown({     smCalcs, ...globalRenderFunctions, ...mipConfig }),
            dexRewarderMarkdown({     dexCalcs, ...globalRenderFunctions, ...mipConfig }),
            marketsString,
            definitionMarkdown(),
        ]

        let formattedProposal = proposalContent.join('\n') + "\n"

        formattedProposal += '---\n'
        formattedProposal += `Config Hash: \`${configHash}\`\n`
        formattedProposal += `<details> <summary>Proposal Config</summary> <pre>${rawConfigData}</pre> </details>`

        console.log(formattedProposal)
        fs.writeFileSync('proposal-content.md', formattedProposal)
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
