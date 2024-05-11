#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { omit, template } from "lodash";
import { BigNumber } from "bignumber.js";
import {
    addProposalToPropData,
    emissionTable,
    formatNumber,
    govRewardSpeeds,
    loadTemplate, multiEmissionTable,
    ONE_DAY_IN_SECONDS, ONE_WEEK_IN_SECONDS, ONE_YEAR_IN_DAYS
} from "../src/lib";
import { COMPONENT, MARKET_SIDE, MipConfig, NETWORK, REWARD_TYPE } from "../src/types";
import defaultConfig from "../src/defaults";
import { ethers, BigNumber as EthersBigNumber } from "ethers";
import { generateProposalMarkdown, getMarkdownFunctions } from "../src/markdown";

import chalk from 'chalk'
import { OptionValues, program } from "commander";

function printIntro() {
    console.log("Welcome to the proposal generator!")
    console.log("This tool reads in a config from the \`generate-config\` tool and produces a proposal and corresponding JSON needed to submit this market adjustment on-chain.")
    console.log()
}

// Sanity checks for the config being read in
async function doSanityChecks(mipData: any, options: OptionValues) {
    // Check component splits equal 100%
    const componentSums = Object.values(mipData.responses.componentSplits).reduce((acc: BigNumber, percent: any) => { return acc.plus(percent) }, new BigNumber(0))
    if (!componentSums.isEqualTo(1)) {
        console.log("Component splits:\n", mipData.responses.componentSplits)
        throw new Error("Component don't equal 1!")
    }

    // Check market distribution splits equal 100%
    const govRewardSplits = Object.values(mipData.marketData.govRewardSplits).reduce((acc: BigNumber, percent: any) => { return acc.plus(percent) }, new BigNumber(0))
    if (!govRewardSplits.isEqualTo(1)) {
        console.log("Gov Market splits:\n", mipData.marketData.rewardSplits)
        throw new Error("Market splits don't equal 1!")
    }

    // Check market distribution splits equal 100%
    const nativeRewardSplits = Object.values(mipData.marketData.nativeRewardSplits).reduce((acc: BigNumber, percent: any) => { return acc.plus(percent) }, new BigNumber(0))
    if (!nativeRewardSplits.isEqualTo(1)) {
        console.log("Native Market splits:\n", mipData.marketData.rewardSplits)
        throw new Error("Market splits don't equal 1!")
    }

    // Ensure all market splits also total 100%
    Object.entries(mipData.marketData.assets).forEach(([marketTicker, marketData]: [string, any]) => {
        const govSupply = new BigNumber(marketData.govSupplyBorrowSplit[MARKET_SIDE.SUPPLY])
        const govBorrow = new BigNumber(marketData.govSupplyBorrowSplit[MARKET_SIDE.BORROW])
        if (!govSupply.plus(govBorrow).isEqualTo(1)) {
            throw new Error(`The gov side split on market ${marketTicker} doesn't add up to 1! ${JSON.stringify(marketData.supplyBorrowSplit)}`)
        }

        const nativeSupply = new BigNumber(marketData.nativeSupplyBorrowSplit[MARKET_SIDE.SUPPLY])
        const nativeBorrow = new BigNumber(marketData.nativeSupplyBorrowSplit[MARKET_SIDE.BORROW])
        if (!nativeSupply.plus(nativeBorrow).isEqualTo(1)) {
            throw new Error(`The native side split on market ${marketTicker} doesn't add up to 1! ${JSON.stringify(marketData.supplyBorrowSplit)}`)
        }
    })

    // Ensure that the block used isn't more than a week old
    const config = defaultConfig[mipData.config.networkName as NETWORK]
    const provider = new ethers.providers.JsonRpcProvider(config.rpc)
    const configBlock = await provider.getBlock(mipData.snapshotBlock)
    const now = new Date().getTime() / 1000

    const timeDelta = new BigNumber(now).minus(configBlock.timestamp)
    const timeDeltaInDays = timeDelta.div(ONE_DAY_IN_SECONDS)
    if (timeDelta.isGreaterThan(ONE_WEEK_IN_SECONDS) && !options.oldBlocksAreOk) {
        throw new Error(`The specified block found in the config file (${configBlock.number.toLocaleString()}) is ${timeDeltaInDays.toFixed(2)} days old, which is older than a week!\nThis data is probably too stale to be used in a proposal, please generate a new config file!`)
    }
}

export async function getDexCalcs(mipConfig: any, govTokenAmountToEmit: number) {
    const dexSplitPercentage = mipConfig.responses.componentSplits[COMPONENT.DEX_REWARDER]
    const dexTokensToEmit = new BigNumber(govTokenAmountToEmit).times(dexSplitPercentage)
    const currentEndTime = mipConfig.dexInfo.currentPoolRewardInfo.endTimestamp

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
    const newDEXEndTimestamp = currentEndTime + (ONE_DAY_IN_SECONDS * mipConfig.config.daysPerRewardCycle)

    let dexRewarderChangedPercentString
    if (dexRewarderChangedPercent.integerValue().isGreaterThan(0)) {
        dexRewarderChangedPercentString = `to <span style="color:#5CCC4E">increase</span> emissions <span style="color:#5CCC4E">+${formatNumber(dexRewarderChangedPercent, 2)}%</span>`
    } else if (dexRewarderChangedPercent.integerValue().isLessThan(0)) {
        dexRewarderChangedPercentString = `to <span style="color:red">decrease</span> emissions <span style="color:red">${formatNumber(dexRewarderChangedPercent, 2)}%</span>`
    } else {
        dexRewarderChangedPercentString = `<span style="color:#FFCF60">to keep emissions the same</span>`
    }

    return {
        dexTokensToEmit,
        newDEXEmissionsPerSecond,
        newDEXEmissionAPR,
        newDEXEndTimestamp,
        dexRewarderChangedPercentString,
        dexRewarderChangedPercent
    }
}

export async function getSafetyModuleCalcs(mipConfig: any, govTokenAmountToEmit: number) {
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
    if (safetyModuleChangedPercent.integerValue().isGreaterThan(0)) {
        smChangePercentString = `to <span style="color:#5CCC4E">increase</span> emissions <span style="color:#5CCC4E">+${formatNumber(safetyModuleChangedPercent, 2)}%</span>`
    } else if (safetyModuleChangedPercent.integerValue().isLessThan(0)) {
        smChangePercentString = `to <span style="color:red">decrease</span> emissions <span style="color:red">${formatNumber(safetyModuleChangedPercent, 2)}%</span>`
    } else {
        smChangePercentString = `to <span style="color:#FFCF60">keep emissions the same</span>`
    }

    return {
        smTokensToEmit,
        newSMEmissionsPerSecond,
        newSMEmissionAPR,
        smChangePercentString,
        safetyModuleChangedPercent
    }
}

function getNativeAssetPrice(mipConfig: MipConfig) {
    if (mipConfig.responses.network === NETWORK.MOONBEAM) {
        return mipConfig.marketData.assets['GLMR'].price
    } else {
        return mipConfig.marketData.assets['MOVR'].price
    }
}

function getMarketCalcs(
    mipConfig: any,
    totalGovTokenAmountToEmit: BigNumber,
    totalNativeTokenAmountToEmit: BigNumber,
    individualMarketData: any,
    govRewardSplit: number,
    nativeRewardSplit: number,
) {
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

    const currentGovSupplyPerSecond = new BigNumber(individualMarketData.govSupplySpeed).div(1e18)
    const currentGovSupplyPerDay = currentGovSupplyPerSecond.times(ONE_DAY_IN_SECONDS)

    const currentGovBorrowPerSecond = new BigNumber(individualMarketData.govBorrowSpeed).div(1e18)
    const currentGovBorrowPerDay = currentGovBorrowPerSecond.times(ONE_DAY_IN_SECONDS)

    const currentNativeSupplyPerSecond = new BigNumber(individualMarketData.nativeSupplySpeed).div(1e18)
    const currentNativeSupplyPerDay = currentNativeSupplyPerSecond.times(ONE_DAY_IN_SECONDS)

    const currentNativeBorrowPerSecond = new BigNumber(individualMarketData.nativeBorrowSpeed).div(1e18)
    const currentNativeBorrowPerDay = currentNativeBorrowPerSecond.times(ONE_DAY_IN_SECONDS)

    function calculateAPRs(
        govPrice: number,
        nativePrice: number | string,
        govSupplyPerDay: BigNumber,
        nativeSupplyPerDay: BigNumber,
        TVL: BigNumber,
        baseAPR: BigNumber,
        supply: boolean,
    ) {
        const govAPR = new BigNumber(govPrice)
            .times(govSupplyPerDay)
            .div(TVL)
            .times(365)
            .times(100)

        const nativeAPR = new BigNumber(nativePrice)
            .times(nativeSupplyPerDay)
            .div(individualMarketData.totalSuppliedTVL)
            .times(365)
            .times(100)

        const protocolAPR = new BigNumber(baseAPR).shiftedBy(-18)
            .times(ONE_DAY_IN_SECONDS)
            .plus(1)
            .pow(365)
            .minus(1)
            .times(100)

        const distributionAPR = govAPR.plus(nativeAPR)

        let totalAPR
        if (supply) {
            totalAPR = distributionAPR.plus(protocolAPR)
        } else {
            totalAPR = distributionAPR.minus(protocolAPR)
        }

        return {
            govAPR,
            nativeAPR,
            protocolAPR,
            distributionAPR,
            totalAPR,
        }
    }

    return {
        // Current stuff
        currentGovSupplyPerSecond,
        currentGovSupplyPerDay,
        currentGovSupplyPerPeriod: currentGovSupplyPerDay.times(DAYS_PER_CYCLE),

        currentGovBorrowPerSecond,
        currentGovBorrowPerDay,
        currentGovBorrowPerPeriod: currentGovBorrowPerDay.times(DAYS_PER_CYCLE),

        currentNativeSupplyPerSecond,
        currentNativeSupplyPerDay,
        currentNativeSupplyPerPeriod: new BigNumber(individualMarketData.nativeSupplySpeed).div(1e18).times(ONE_DAY_IN_SECONDS).times(DAYS_PER_CYCLE),

        currentNativeBorrowPerSecond,
        currentNativeBorrowPerDay,
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
        proposedBorrowNativeTokensPerPeriod: proposedBorrowNativeTokensPerSecond.times(ONE_DAY_IN_SECONDS).times(DAYS_PER_CYCLE),

        currentSupplyAPRs: calculateAPRs(
            mipConfig.dexInfo.govTokenPrice,
            getNativeAssetPrice(mipConfig),
            currentGovSupplyPerDay,
            currentNativeSupplyPerDay,
            individualMarketData.totalSuppliedTVL,
            individualMarketData.baseSupplyAPR,
            true
        ),

        proposedSupplyAPRs: calculateAPRs(
            mipConfig.dexInfo.govTokenPrice,
            getNativeAssetPrice(mipConfig),
            proposedSupplyGovTokensPerSecond.times(ONE_DAY_IN_SECONDS),
            proposedSupplyNativeTokensPerSecond.times(ONE_DAY_IN_SECONDS),
            individualMarketData.totalSuppliedTVL,
            individualMarketData.baseSupplyAPR,
            true
        ),

        currentBorrowAPRs: calculateAPRs(
            mipConfig.dexInfo.govTokenPrice,
            getNativeAssetPrice(mipConfig),
            currentGovBorrowPerDay,
            currentNativeBorrowPerDay,
            individualMarketData.totalBorrowedTVL,
            individualMarketData.baseBorrowAPR,
            false
        ),

        proposedBorrowAPRs: calculateAPRs(
            mipConfig.dexInfo.govTokenPrice,
            getNativeAssetPrice(mipConfig),
            proposedBorrowGovTokensPerSecond.times(ONE_DAY_IN_SECONDS),
            proposedBorrowNativeTokensPerSecond.times(ONE_DAY_IN_SECONDS),
            individualMarketData.totalBorrowedTVL,
            individualMarketData.baseBorrowAPR,
            false
        )
    }
}

function formatPercentAsSpan(percent: BigNumber) {
    if (!percent.isFinite()) {
        return `<span style="color:#5CCC4E">+0%</span>`
    }
    if (percent.isGreaterThanOrEqualTo(0)) {
        return `<span style="color:#5CCC4E">+${percent.times(100).toFixed(2)}%</span>`
    } else {
        return `<span style="color:red">${percent.times(100).toFixed(2)}%</span>`
    }
}

export function getMarketDataWithCalcs(
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
            supplyGovChangeFormatted: formatPercentAsSpan(supplyGovChange),
            borrowGovChangeFormatted: formatPercentAsSpan(borrowGovChange),
            supplyNativeChangeFormatted: formatPercentAsSpan(supplyNativeChange),
            borrowNativeChangeFormatted: formatPercentAsSpan(borrowNativeChange),
            ...globalRenderFunctions, ...mipConfig
        })

        acc[ticker] = {
            marketSplit,
            marketGovTokensToEmit,
            marketNativeTokensToEmit,
            marketCalcs,
            rendered,
            changes: {
                supplyGovChange,
                borrowGovChange,
                supplyNativeChange,
                borrowNativeChange,
            },
            ...individualMarketData
        }
        return acc
    }, {})
}

async function generateProposalJSON(mipConfig: MipConfig, smCalcs: any, dexCalcs: any, marketDataWithCalcs: any, formattedProposal: string) {
    const proposalData = {
        targets: [],
        values: [],
        callDatas: [],
        description: formattedProposal
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

    // console.log(`📝 Sending ${SMSendParam.toLocaleString()} WELL to the ECOSYSTEM_RESERVE`)

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

    // console.log(`📝 Sending ${comptrollerSendParam.toFixed()} WELL to the COMPTROLLER`)
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

    // console.log(`📝 Sending ${dexRewarderSendParam.toLocaleString()} WELL to the DEX_REWARDER`)
    // await addProposalToPropData(govToken, 'transferFrom',
    //     [
    //         config.treasuryAddress,
    //         contracts.TIMELOCK!.address,
    //         EthersBigNumber.from(
    //             dexRewarderSendParam
    //                 .times(mantissa)
    //                 .toFixed()
    //         )
    //     ],
    //     proposalData
    // )

    // Approve dexRewarder to pull WELL from the timelock
    // console.log(`📝 Approving ${dexRewarderSendParam.toLocaleString()} WELL to be pulled by DEX_REWARDER`)
    // await addProposalToPropData(govToken, 'approve',
    //     [
    //         contracts.DEX_REWARDER.address,
    //         EthersBigNumber.from(
    //             dexRewarderSendParam
    //                 .times(mantissa)
    //                 .toFixed()
    //         )
    //     ],
    //     proposalData
    // )

    //
    // Dex rewarder
    //

    // Configure dexRewarder/trigger pulling the WELL rewards
    // console.log(`📝 Calling addRewardInfo on DEX_REWARDER`)
    const currentStartTime = mipConfig.dexInfo.currentPoolRewardInfo.endTimestamp

    // if (mipConfig.dexInfo.addingNewMarket == true) {
    //     await addProposalToPropData(dexRewarder, 'add',
    //         [
    //             config.dexPoolID,
    //             10000, /// 10k allocation points, should not matter as no other pools added
    //             currentStartTime
    //         ],
    //         proposalData
    //     )
    // }

    // await addProposalToPropData(dexRewarder, 'addRewardInfo',
    //     [
    //         config.dexPoolID,
    //         dexCalcs.newDEXEndTimestamp,
    //         EthersBigNumber.from(
    //             dexRewarderSendParam
    //                 .div(mipConfig.config.daysPerRewardCycle)
    //                 .div(ONE_DAY_IN_SECONDS)
    //                 .shiftedBy(18)
    //                 .integerValue(BigNumber.ROUND_DOWN)
    //                 .toFixed()
    //         )
    //     ],
    //     proposalData
    // )

    //
    // Safety Module
    //

    // Only update if necessary
    const currentSMEmissions = new BigNumber(mipConfig.safetyModuleInfo.emissions.emissionsPerSecond)
    if (currentSMEmissions.isEqualTo(smCalcs.newSMEmissionsPerSecond)) {
        // console.log(`⏭️ Skipping adjusting the SAFETY_MODULE`)
    } else {
        // Configure new reward speeds for stkWELL
        // console.log(`📝 Calling configureAsset on SAFETY_MODULE`)
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

    for (const market of Object.entries(marketDataWithCalcs)) {
        const [marketTicker, marketData]: any[] = market
        const marketCalcs = marketData.marketCalcs

        // Gov Token emissions for this market
        // console.log(`📝 Adjusting ${config.govTokenName} emissions for the ${marketTicker} market`)

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
        // console.log(`📝 Adjusting ${config.nativeTokenName} emissions for the ${marketTicker} market`)

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

    if (mipConfig.config.networkName === NETWORK.MOONBEAM) {

        // Manually define the function signature
        const functionSignature = "propose(address[],uint256[],bytes[],string)";

        // Create a FunctionFragment from the signature
        const functionFragment = ethers.utils.FunctionFragment.from(functionSignature);

        // Encode the function call using the Interface
        const iface = new ethers.utils.Interface([functionFragment]);
        const encodedData = iface.encodeFunctionData(functionFragment, [
            proposalData.targets,
            proposalData.values,
            proposalData.callDatas,
            proposalData.description,
        ]);

        console.log("\n\n\n  Multichain Governor Propose Calldata\n");
        console.log(encodedData);
        console.log("\n");
    } else {
        /// Moonriver network deployment and logging
        const functionSignature = "propose(address[],uint256[],string[],bytes[],string)";

        // Create a FunctionFragment from the signature
        const functionFragment = ethers.utils.FunctionFragment.from(functionSignature);

        // Encode the function call using the Interface
        const iface = new ethers.utils.Interface([functionFragment]);
        const signatures = new Array<string>(proposalData.targets.length).fill("");
        const encodedData = iface.encodeFunctionData(functionFragment, [
            proposalData.targets,
            proposalData.values,
            signatures,
            proposalData.callDatas,
            proposalData.description,
        ]);

        console.log("\n\n\n  Moonriver Governor Propose Calldata\n");
        console.log(encodedData, "\n\n");
    }

    return proposalData
}

export async function printPropsalSummary(
    mipConfig: MipConfig,
    globalRenderFunctions: any,
    smCalcs: any,
    dexCalcs: any,
    marketDataWithCalcs: any
) {
    const introMarkdown = template(loadTemplate('intro.md.ejs', 'cli'))
    const safetyModuleMarkdown = template(loadTemplate('safety-module.md.ejs', 'cli'))
    const dexRewarderMarkdown = template(loadTemplate('dex-rewarder.md.ejs', 'cli'))
    const marketTopperMarkdown = template(loadTemplate('market-topper.md.ejs', 'cli'))
    const marketMarkdown = template(loadTemplate('market.md.ejs', 'cli'))

    // console.log(JSON.stringify({smCalcs}, null, 2))

    const contracts = defaultConfig[mipConfig.config.networkName as NETWORK].contracts

    console.log(`${chalk.bold.greenBright('===== Proposal Info =====')}`)
    console.log()

    const outputs = [
        introMarkdown({ ...mipConfig, ...globalRenderFunctions }),
        // Safety Module
        safetyModuleMarkdown({
            smCalcs,
            emissionTable, ...globalRenderFunctions, ...mipConfig
        }),
        // Dex Rewarder
        dexRewarderMarkdown({
            dexCalcs,
            emissionTable, ...globalRenderFunctions, ...mipConfig
        }),
        // Markets
        marketTopperMarkdown({
            ...globalRenderFunctions, ...mipConfig
        }),
        Object.entries(marketDataWithCalcs).map(([marketTicker, individualMarketData]: any) => {
            return marketMarkdown({
                marketTicker, individualMarketData,
                multiEmissionTable, ...globalRenderFunctions, ...mipConfig,
            })
        }).join("\n")
    ]

    console.log(outputs.join("\n"))
}

export default async function generateProposal(mipPath: string, options: OptionValues) {
    const mipPathNormalized = path.resolve('./', mipPath)
    if (fs.existsSync(mipPathNormalized)) {
        const rawConfigData = fs.readFileSync(mipPathNormalized, { encoding: 'utf8', flag: 'r' })
        const mipConfig: MipConfig = JSON.parse(rawConfigData)

        // console.log(rawConfigData)

        await doSanityChecks(mipConfig, options)

        const govTokenAmountToEmit = mipConfig.responses.emissionAmounts[REWARD_TYPE.GOV_TOKEN]
        const nativeTokenAmountToEmit = mipConfig.responses.emissionAmounts[REWARD_TYPE.NATIVE_TOKEN]
        const globalRenderFunctions = { BigNumber, formatNumber, govRewardSpeeds, chalk }

        const markdownFunctions = await getMarkdownFunctions(mipConfig)

        const smCalcs = await getSafetyModuleCalcs(mipConfig, govTokenAmountToEmit)

        const dexCalcs = await getDexCalcs(mipConfig, govTokenAmountToEmit)

        const marketDataWithCalcs = getMarketDataWithCalcs(
            mipConfig,
            govTokenAmountToEmit,
            nativeTokenAmountToEmit,
            markdownFunctions.marketsMarkdown,
            globalRenderFunctions,
        )

        // Strip off "Meta" stuff
        const configToHash = JSON.stringify(omit(mipConfig, '_meta'), null, 2)
        const configHash = require('crypto').createHash('sha256').update(configToHash).digest('hex')

        await printPropsalSummary(
            mipConfig,
            globalRenderFunctions,
            smCalcs, dexCalcs, marketDataWithCalcs
        )

        const formattedProposal = generateProposalMarkdown(
            mipConfig,
            globalRenderFunctions,
            markdownFunctions,
            smCalcs, dexCalcs, marketDataWithCalcs,
            configHash
        )

        const proposalJSON = await generateProposalJSON(
            mipConfig, smCalcs, dexCalcs, marketDataWithCalcs, formattedProposal
        )

        const proposalJSONFormatted = JSON.stringify(proposalJSON, null, 2)

        const descriptionFile = `MIP-${mipConfig.responses.mipNumber}-description.md`
        const proposalFile = `MIP-${mipConfig.responses.mipNumber}-proposal.json`

        fs.writeFileSync(descriptionFile, formattedProposal)
        fs.writeFileSync(proposalFile, proposalJSONFormatted)

        console.log()
        console.log(`All done! Wrote ${chalk.yellowBright(descriptionFile)} and ${chalk.yellowBright(proposalFile)} to the current directory.`)
        console.log(`Please submit the ${chalk.yellowBright(proposalFile)} to the governance portal to put it on chain 🎉!`)

    } else {
        console.log(`Sorry, ${mipPath} doesn't seem like a path to a MIP config...`)
        process.exit(1)
    }
}

if (require.main === module) {
    (async () => {
        program
            .name("Moonwell Market Adjuster Proposal Generator")
            .option('--oldBlocksAreOk', "An override to generate a proposal with an old block", false)
            .version(require('../package.json').version, '-v, --vers', 'Print the current version')

        program.parse(process.argv)

        if (program.args.length === 0) {
            console.log("Please specify the path to a MIP configuration file (usually found in configs/)")
            process.exit(1)
        } else if (program.args.length > 1) {
            console.log("Please only specify the path to a single MIP configuration file")
            process.exit(1)
        }

        await printIntro()
        await generateProposal(program.args[0], program.opts())
    })();
}
