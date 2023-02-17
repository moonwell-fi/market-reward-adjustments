import fs from "fs";
import path from "path";
import {omit, template} from "lodash";
import {BigNumber} from "bignumber.js";
import {addProposalToPropData, formatNumber} from "./src/lib";
import {COMPONENT, MARKET_SIDE, MipConfig, NETWORK, REWARD_TYPE} from "./src/types";
import defaultConfig from "./configs/defaults";
import {ethers, BigNumber as EthersBigNumber} from "ethers";

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
    const govRewardSplits = Object.values(mipData.marketData.govRewardSplits).reduce((acc: BigNumber, percent: any) => { return acc.plus(percent) }, new BigNumber(0))
    if (!govRewardSplits.isEqualTo(1)){
        console.log("Gov Market splits:\n", mipData.marketData.rewardSplits)
        throw new Error("Market splits don't equal 1!")
    }

    // Check market distribution splits equal 100%
    const nativeRewardSplits = Object.values(mipData.marketData.nativeRewardSplits).reduce((acc: BigNumber, percent: any) => { return acc.plus(percent) }, new BigNumber(0))
    if (!nativeRewardSplits.isEqualTo(1)){
        console.log("Native Market splits:\n", mipData.marketData.rewardSplits)
        throw new Error("Market splits don't equal 1!")
    }

    Object.entries(mipData.marketData.assets).forEach(([marketTicker, marketData]: [string, any]) => {
        const govSupply = new BigNumber(marketData.govSupplyBorrowSplit[MARKET_SIDE.SUPPLY])
        const govBorrow = new BigNumber(marketData.govSupplyBorrowSplit[MARKET_SIDE.BORROW])
        if (!govSupply.plus(govBorrow).isEqualTo(1)){
            throw new Error(`The gov side split on market ${marketTicker} doesn't add up to 1! ${JSON.stringify(marketData.supplyBorrowSplit)}`)
        }

        const nativeSupply = new BigNumber(marketData.nativeSupplyBorrowSplit[MARKET_SIDE.SUPPLY])
        const nativeBorrow = new BigNumber(marketData.nativeSupplyBorrowSplit[MARKET_SIDE.BORROW])
        if (!nativeSupply.plus(nativeBorrow).isEqualTo(1)){
            throw new Error(`The native side split on market ${marketTicker} doesn't add up to 1! ${JSON.stringify(marketData.supplyBorrowSplit)}`)
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

function getMarketCalcs(mipConfig: any, totalGovTokenAmountToEmit: BigNumber, totalNativeTokenAmountToEmit: BigNumber, individualMarketData: any, govRewardSplit: number, nativeRewardSplit: number) {
    const govTokensToEmit = totalGovTokenAmountToEmit.times(govRewardSplit)
    const nativeTokensToEmit = totalNativeTokenAmountToEmit.times(nativeRewardSplit)

    const SUPPLY_PERCENT_GOV = individualMarketData.govSupplyBorrowSplit[MARKET_SIDE.SUPPLY]
    const BORROW_PERCENT_GOV = individualMarketData.govSupplyBorrowSplit[MARKET_SIDE.BORROW]
    const SUPPLY_PERCENT_NATIVE = individualMarketData.nativeSupplyBorrowSplit[MARKET_SIDE.SUPPLY]
    const BORROW_PERCENT_NATIVE = individualMarketData.nativeSupplyBorrowSplit[MARKET_SIDE.BORROW]

    const DAYS_PER_CYCLE = mipConfig.config.daysPerRewardCycle

    const proposedSupplyGovTokensPerSecond = govTokensToEmit.times(SUPPLY_PERCENT_GOV).div(DAYS_PER_CYCLE).div(ONE_DAY_IN_SECONDS)
    const proposedBorrowGovTokensPerSecond = govTokensToEmit.times(BORROW_PERCENT_GOV).div(DAYS_PER_CYCLE).div(ONE_DAY_IN_SECONDS)
    const proposedSupplyNativeTokensPerSecond = nativeTokensToEmit.times(SUPPLY_PERCENT_NATIVE).div(DAYS_PER_CYCLE).div(ONE_DAY_IN_SECONDS)
    const proposedBorrowNativeTokensPerSecond = nativeTokensToEmit.times(BORROW_PERCENT_NATIVE).div(DAYS_PER_CYCLE).div(ONE_DAY_IN_SECONDS)

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

function formatPercentAsSpan(percent: BigNumber){
    if (!percent.isFinite()){
        return `<span style="color:#5CCC4E">+0%</span>`
    }
    if (percent.isGreaterThanOrEqualTo(0)){
        return `<span style="color:#5CCC4E">+${percent.times(100).toFixed(2)}%</span>`
    } else {
        return `<span style="color:red">${percent.times(100).toFixed(2)}%</span>`
    }
}

function getMarketDataWithCalcs(
    mipConfig: any,
    govTokenAmountToEmit: number,
    nativeTokenAmountToEmit: number,
    marketsMarkdown: Function,
    globalRenderFunctions: any
) {
    return Object.entries(mipConfig.marketData.assets).reduce((acc: any, [ticker, individualMarketData]: any) => {
        const marketSplit = mipConfig.responses.componentSplits[COMPONENT.ALL_MARKETS]
        const marketGovTokensToEmit = new BigNumber(govTokenAmountToEmit).times(marketSplit)
        // Native tokens don't get split into anything else
        const marketNativeTokensToEmit = new BigNumber(nativeTokenAmountToEmit)

        // console.log('hmm', mipConfig.marketData)

        const marketCalcs = getMarketCalcs(
            mipConfig,
            marketGovTokensToEmit,
            marketNativeTokensToEmit,
            individualMarketData,
            mipConfig.marketData.govRewardSplits[ticker],
            mipConfig.marketData.nativeRewardSplits[ticker],
        )

        const supplyGovChange = new BigNumber(1).minus(
            marketCalcs.currentGovSupplyPerSecond.div(marketCalcs.proposedSupplyGovTokensPerSecond)
        )
        const borrowGovChange = new BigNumber(1).minus(
            marketCalcs.currentGovBorrowPerSecond.div(marketCalcs.proposedBorrowGovTokensPerSecond)
        )

        const supplyNativeChange = new BigNumber(1).minus(
            marketCalcs.currentNativeSupplyPerSecond.div(marketCalcs.proposedSupplyNativeTokensPerSecond)
        )
        const borrowNativeChange = new BigNumber(1).minus(
            marketCalcs.currentNativeBorrowPerSecond.div(marketCalcs.proposedBorrowNativeTokensPerSecond)
        )

        const config = defaultConfig[mipConfig.config.networkName as NETWORK]
        const mTokenAddress = config.contracts.MARKETS[ticker].mTokenAddress

        const rendered = marketsMarkdown({
            mTokenAddress, ticker, individualMarketData, marketCalcs,
            supplyGovChange: formatPercentAsSpan(supplyGovChange),
            borrowGovChange: formatPercentAsSpan(borrowGovChange),
            supplyNativeChange: formatPercentAsSpan(supplyNativeChange),
            borrowNativeChange: formatPercentAsSpan(borrowNativeChange),
            ...globalRenderFunctions, ...mipConfig
        })

        acc[ticker] = {
            marketSplit,
            marketGovTokensToEmit,
            marketNativeTokensToEmit,
            marketCalcs,
            rendered,
            ...individualMarketData
        }
        return acc
    }, {})
}

function generateProposalMarkdown(
    mipConfig: any,
    globalRenderFunctions: any,
    markdownFunctions: any,
    smCalcs: any, dexCalcs: any, marketDataWithCalcs: any,
) {
    // Strip off "Meta" stuff
    const configToHash = JSON.stringify(omit(mipConfig, '_meta'), null, 2)
    const configHash = require('crypto').createHash('sha256').update(configToHash).digest('hex')

    console.log("Config hash:", configHash)

    const proposalContent = [
        markdownFunctions.introMarkdown(mipConfig),
        // Safety Module
        markdownFunctions.safetyModuleMarkdown({ smCalcs, ...globalRenderFunctions, ...mipConfig }),

        // Dex Rewarder
        markdownFunctions.dexRewarderMarkdown({ dexCalcs, ...globalRenderFunctions, ...mipConfig }),

        // Markets
        markdownFunctions.marketTopperMarkdown({ ...globalRenderFunctions, ...mipConfig }),
        Object.values(marketDataWithCalcs).map((marketData: any) => marketData.rendered ).join('\n'),

        // Definitions
        markdownFunctions.definitionMarkdown(),
    ]

    let formattedProposal = proposalContent.join('\n') + "\n"

    const rawConfigData = JSON.stringify(mipConfig, null, 2)

    formattedProposal += '---\n'
    formattedProposal += `Config Hash: \`${configHash}\`\n`
    formattedProposal += `<details> <summary>Proposal Config</summary> <pre>${rawConfigData}</pre> </details>`

    return formattedProposal
}

async function generateProposalJSON(mipConfig: MipConfig, smCalcs: any, dexCalcs: any, marketDataWithCalcs: any, formattedProposal: string) {
    const proposalData = {
        targets: [],
        values: [],
        signatures: [],
        callDatas: [],
        description: Buffer.from(formattedProposal).toString('base64')
    }

    const config = defaultConfig[mipConfig.config.networkName as NETWORK]
    const provider = new ethers.providers.JsonRpcProvider(config.rpc)
    const contracts = config.contracts
    const mantissa = new BigNumber(10).pow(18)

    const govToken = contracts.GOV_TOKEN.contract.connect(provider)
    const unitroller = contracts.COMPTROLLER.contract.connect(provider)
    const stkWELL = contracts.SAFETY_MODULE.contract.connect(provider)
    const dexRewarder = contracts.DEX_REWARDER.contract.connect(provider)

    //
    // Treasury Ops
    //

    // Send some amt to the submitter
    await addProposalToPropData(govToken, 'transferFrom',
        [
            config.treasuryAddress,
            mipConfig.responses.submitterWallet,
            EthersBigNumber.from(
                new BigNumber(config.submissionRewardAmount).shiftedBy(18).toFixed()
            )
        ],
        proposalData
    )

    // Send WELL from F-GLMR-LM to ecosystemReserve
    const SMSendParam = new BigNumber(smCalcs.smTokensToEmit)
                            .integerValue(BigNumber.ROUND_UP)
                            .plus(1)  // Add a buffer WELL token in case there's some rounding issues

    console.log(`📝 Sending ${SMSendParam.toLocaleString()} WELL to the ECOSYSTEM_RESERVE`)

    await addProposalToPropData(govToken, 'transferFrom',
        [
            config.treasuryAddress,
            config.ecosystemReserve,
            EthersBigNumber.from(
                SMSendParam
                    .times(mantissa)
                    .toFixed()
            )
        ],
        proposalData
    )

    // Send WELL from F-GLMR-LM to unitroller
    const govTokensToEmitToMarkets = (Object.values(marketDataWithCalcs)[0] as any).marketGovTokensToEmit
    const comptrollerSendParam = new BigNumber(govTokensToEmitToMarkets)
                                    .integerValue(BigNumber.ROUND_UP)

    console.log(`📝 Sending ${comptrollerSendParam.toFixed()} WELL to the COMPTROLLER`)
    await addProposalToPropData(govToken, 'transferFrom',
        [
            config.treasuryAddress,
            contracts.COMPTROLLER.address,
            EthersBigNumber.from(
                comptrollerSendParam
                    .times(mantissa)
                    .toFixed()
            )
        ],
        proposalData
    )

    // Pull in WELL to the timelock from F-GLMR-LM
    const dexRewarderSendParam = new BigNumber(dexCalcs.dexTokensToEmit)
                                    .integerValue(BigNumber.ROUND_UP)
                                    .plus(2)

    console.log(`📝 Sending ${dexRewarderSendParam.toLocaleString()} WELL to the DEX_REWARDER`)
    await addProposalToPropData(govToken, 'transferFrom',
        [
            config.treasuryAddress,
            contracts.TIMELOCK!.address,
            EthersBigNumber.from(
                dexRewarderSendParam
                    .times(mantissa)
                    .toFixed()
            )
        ],
        proposalData
    )

    // Approve dexRewarder to pull WELL from the timelock
    console.log(`📝 Approving ${dexRewarderSendParam.toLocaleString()} WELL to be pulled by DEX_REWARDER`)
    await addProposalToPropData(govToken, 'approve',
        [
            contracts.DEX_REWARDER.address,
            EthersBigNumber.from(
                dexRewarderSendParam
                    .times(mantissa)
                    .toFixed()
            )
        ],
        proposalData
    )

    //
    // Dex rewarder
    //

    // Configure dexRewarder/trigger pulling the WELL rewards
    console.log(`📝 Calling addRewardInfo on DEX_REWARDER`)
    const currentEndTime = mipConfig.dexInfo.currentPoolRewardInfo.endTimestamp
    console.log({
        // endTime: currentEndTime + (ONE_DAY_IN_SECONDS * mipConfig.config.daysPerRewardCycle)
        eps: dexRewarderSendParam
            .div(mipConfig.config.daysPerRewardCycle)
            .div(ONE_DAY_IN_SECONDS)
            .shiftedBy(18)
            .integerValue(BigNumber.ROUND_DOWN)
            .toFixed()
    })
    await addProposalToPropData(dexRewarder, 'addRewardInfo',
        [
            config.dexPoolID,
            currentEndTime + (ONE_DAY_IN_SECONDS * mipConfig.config.daysPerRewardCycle),
            EthersBigNumber.from(
                dexRewarderSendParam
                    .div(mipConfig.config.daysPerRewardCycle)
                    .div(ONE_DAY_IN_SECONDS)
                    .shiftedBy(18)
                    .integerValue(BigNumber.ROUND_DOWN)
                    .toFixed()
            )
        ],
        proposalData
    )

    //
    // Safety Module
    //

    // Only update if necessary
    const currentSMEmissions = new BigNumber(mipConfig.safetyModuleInfo.emissions.emissionsPerSecond)
    if (currentSMEmissions.isEqualTo(smCalcs.newSMEmissionsPerSecond)){
        console.log(`⏭️ Skipping adjusting the SAFETY_MODULE`)
    } else {
        // Configure new reward speeds for stkWELL
        console.log(`📝 Calling configureAsset on SAFETY_MODULE`)
        await addProposalToPropData(stkWELL, 'configureAsset',
            [
                EthersBigNumber.from(
                    smCalcs.newSMEmissionsPerSecond.shiftedBy(18).integerValue(BigNumber.ROUND_DOWN).toFixed()
                ),
                stkWELL.address
            ],
            proposalData
        )
    }

    //
    // Market Configs
    //

    for (const market of Object.entries(marketDataWithCalcs)){
        const [marketTicker, marketData]: any[] = market
        const marketCalcs = marketData.marketCalcs

        // Gov Token emissions for this market
        console.log(`📝 Adjusting ${config.govTokenName} emissions for the ${marketTicker} market`)

        console.log({marketCalcs: {
                proposedBorrowGovTokensPerSecond: marketCalcs.proposedBorrowGovTokensPerSecond.toFixed(),
                proposedSupplyGovTokensPerSecond: marketCalcs.proposedSupplyGovTokensPerSecond.toFixed()
        }})

        // If we have a 0 for borrow side, make sure it's 1
        let borrowGovTokensPerSecond = marketCalcs.proposedBorrowGovTokensPerSecond
            .shiftedBy(18)
            .integerValue(BigNumber.ROUND_DOWN)

        if (borrowGovTokensPerSecond.isZero()) {
            borrowGovTokensPerSecond = new BigNumber(1)
        }
        await addProposalToPropData(unitroller, '_setRewardSpeed',
            [
                REWARD_TYPE.GOV_TOKEN,
                contracts.MARKETS[marketTicker].mTokenAddress,
                EthersBigNumber.from(
                    marketCalcs.proposedSupplyGovTokensPerSecond
                        .shiftedBy(18)
                        .integerValue(BigNumber.ROUND_DOWN)
                        .toFixed()
                ),
                EthersBigNumber.from(
                    borrowGovTokensPerSecond.toFixed()
                ),
            ],
            proposalData
        )

        // Native Token emissions for this market
        console.log(`📝 Adjusting ${config.nativeTokenName} emissions for the ${marketTicker} market`)

        // If we have a 0 for borrow side, make sure it's 1
        let borrowNativeTokensPerSecond = marketCalcs.proposedBorrowNativeTokensPerSecond
            .shiftedBy(18)
            .integerValue(BigNumber.ROUND_DOWN)

        if (borrowNativeTokensPerSecond.isZero()) {
            borrowNativeTokensPerSecond = new BigNumber(1)
        }

        await addProposalToPropData(unitroller, '_setRewardSpeed',
            [
                REWARD_TYPE.NATIVE_TOKEN,
                contracts.MARKETS[marketTicker].mTokenAddress,
                EthersBigNumber.from(
                    marketCalcs.proposedSupplyNativeTokensPerSecond
                        .shiftedBy(18)
                        .integerValue(BigNumber.ROUND_DOWN)
                        .toFixed()
                ),
                EthersBigNumber.from(
                    borrowNativeTokensPerSecond.toFixed()
                ),
            ],
            proposalData
        )
    }
    return proposalData
}

export default async function generateProposal(mipPath: string){
    const mipPathNormalized = path.resolve(__dirname, mipPath)
    if (fs.existsSync(mipPathNormalized)){
        const rawConfigData = fs.readFileSync(mipPathNormalized, {encoding:'utf8', flag:'r'})
        const mipConfig: MipConfig = JSON.parse(rawConfigData)

        // console.log(rawConfigData)

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
        const marketTopperMarkdown = template(loadTemplate('market-topper.md.ejs'))
        const marketsMarkdown = template(loadTemplate('market.md.ejs'))
        const marketDataWithCalcs = getMarketDataWithCalcs(
            mipConfig, govTokenAmountToEmit, nativeTokenAmountToEmit, marketsMarkdown, globalRenderFunctions
        )

        // Definitions section
        const definitionMarkdown = mipConfig.config.networkName === 'Moonbeam' ?
            template(loadTemplate('definitions.artemis.md.ejs')) :
            template(loadTemplate('definitions.apollo.md.ejs'))

        const formattedProposal = generateProposalMarkdown(
            mipConfig, globalRenderFunctions,
            {
                introMarkdown,
                safetyModuleMarkdown,
                dexRewarderMarkdown,
                marketTopperMarkdown,
                marketsMarkdown,
                definitionMarkdown,
            },
            smCalcs, dexCalcs, marketDataWithCalcs
        )

        const proposalJSON = await generateProposalJSON(
            mipConfig, smCalcs, dexCalcs, marketDataWithCalcs, formattedProposal
        )

        console.log("===== PROPOSAL JSON =====")

        console.log(JSON.stringify(proposalJSON, null, 2))

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
