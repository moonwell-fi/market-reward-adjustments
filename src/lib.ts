import { BigNumber } from "bignumber.js";
import { Contract } from "ethers";
import fs from "fs";
import { GlobalConfig } from "./types";
import { getBorderCharacters, table } from "table";
import chalk from "chalk";
import * as path from "path";

export const ONE_YEAR_IN_DAYS = 365.25
export const ONE_DAY_IN_SECONDS = 60 * 60 * 24
export const ONE_WEEK_IN_SECONDS = ONE_DAY_IN_SECONDS * 7

export function formatNumber(num: string | BigNumber, truncate: number = 2) {
    const bigNum = new BigNumber(num)
    // If we have an asset worth less than 1 dollar and no specified truncation, truncate to 4 digits
    if (bigNum.isGreaterThan(-1) && bigNum.isLessThan(1) && truncate === 2) {
        truncate = 4
    }

    // If we have something smaller than 0.000001, treat it as 0 for formatting
    if (bigNum.shiftedBy(6).integerValue().isZero()) {
        truncate = 0
    }

    const truncated = new BigNumber(num).toFixed(truncate)
    return parseFloat(truncated).toLocaleString(undefined, { minimumFractionDigits: truncate, maximumFractionDigits: truncate })
}

export async function addProposalToPropData(contract: Contract, fn: string, args: any[], proposalData: any) {
    const tx = await contract.populateTransaction[fn](...args)

    proposalData.targets.push(contract.address)
    proposalData.values.push(0)

    const methodSelector = contract.interface.getSighash(contract.interface.getFunction(fn));
    const abiEncodedCallData = methodSelector + (tx.data as any).slice(10);
    proposalData.callDatas.push(abiEncodedCallData);
}

export function loadTemplate(templateName: string, dir = 'markdown') {
    return fs.readFileSync(
        path.resolve(`./src/templates/${dir}/${templateName}`),
        { encoding: 'utf8', flag: 'r' }
    )
}

export function govRewardSpeeds(config: any, emissionsPerSecond: BigNumber) {
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

export function emissionTable(config: GlobalConfig, emissionsPerSecond: BigNumber, padding = 8, tokenName?: string) {
    if (!tokenName) {
        tokenName = config.govTokenName
    }
    return table([
        [tokenName + ' per second', chalk.yellowBright(formatNumber(
            emissionsPerSecond,
            4
        ))],
        [tokenName + ' per day', chalk.yellowBright(formatNumber(
            emissionsPerSecond.times(ONE_DAY_IN_SECONDS),
            4
        ))],
        [tokenName + ' per cycle', chalk.yellowBright(formatNumber(
            emissionsPerSecond.times(ONE_DAY_IN_SECONDS).times(config.daysPerRewardCycle),
            4
        ))]
    ], {
        columns: [
            { alignment: 'left' },
            { alignment: 'right' }
        ],
        border: getBorderCharacters('norc')
    }).split('\n').join("\n" + " ".repeat(padding)).trim()
}

export function multiEmissionTable(marketDataWithCalcs: any, config: GlobalConfig, padding = 0) {
    const marketCalcs = marketDataWithCalcs.marketCalcs
    const changes = marketDataWithCalcs.changes

    function formatChange(changeNumDecimal: BigNumber) {
        if (!changeNumDecimal.isFinite()) {
            return "N/A"
        }
        return changeNumDecimal.isGreaterThan(0) ?
            chalk.greenBright("+" + formatNumber(changeNumDecimal.times(100), 2) + "%") :
            chalk.redBright(formatNumber(changeNumDecimal.times(100), 2) + "%")
    }

    const govRewardTable = table([
        ["", chalk.yellowBright("Current"), chalk.yellowBright("Proposed")],
        [`${chalk.yellowBright('Supply')} Side`, chalk.yellowBright(formatNumber(marketCalcs.currentGovSupplyPerSecond, 4)) + " " + config.govTokenName + " /   sec", chalk.yellowBright(formatNumber(marketCalcs.proposedSupplyGovTokensPerSecond, 4)) + " " + config.govTokenName + " /   sec"],
        [formatChange(changes.supplyGovChange), chalk.yellowBright(formatNumber(marketCalcs.currentGovSupplyPerSecond.times(ONE_DAY_IN_SECONDS), 4)) + " " + config.govTokenName + " /   day", chalk.yellowBright(formatNumber(marketCalcs.proposedSupplyGovTokensPerSecond.times(ONE_DAY_IN_SECONDS), 4)) + " " + config.govTokenName + " /   day"],
        ["", chalk.yellowBright(formatNumber(marketCalcs.currentGovSupplyPerSecond.times(ONE_DAY_IN_SECONDS).times(config.daysPerRewardCycle), 4)) + " " + config.govTokenName + " / cycle", chalk.yellowBright(formatNumber(marketCalcs.proposedSupplyGovTokensPerSecond.times(ONE_DAY_IN_SECONDS).times(config.daysPerRewardCycle), 4)) + " " + config.govTokenName + " / cycle"],
        [`${chalk.yellowBright('Borrow')} Side`, chalk.yellowBright(formatNumber(marketCalcs.currentGovBorrowPerSecond, 4)) + " " + config.govTokenName + " /   sec", chalk.yellowBright(formatNumber(marketCalcs.proposedBorrowGovTokensPerSecond, 4)) + " " + config.govTokenName + " /   sec"],
        [formatChange(changes.borrowGovChange), chalk.yellowBright(formatNumber(marketCalcs.currentGovBorrowPerSecond.times(ONE_DAY_IN_SECONDS), 4)) + " " + config.govTokenName + " /   day", chalk.yellowBright(formatNumber(marketCalcs.proposedBorrowGovTokensPerSecond.times(ONE_DAY_IN_SECONDS), 4)) + " " + config.govTokenName + " /   day"],
        ["", chalk.yellowBright(formatNumber(marketCalcs.currentGovBorrowPerSecond.times(ONE_DAY_IN_SECONDS).times(config.daysPerRewardCycle), 4)) + " " + config.govTokenName + " / cycle", chalk.yellowBright(formatNumber(marketCalcs.proposedBorrowGovTokensPerSecond.times(ONE_DAY_IN_SECONDS).times(config.daysPerRewardCycle), 4)) + " " + config.govTokenName + " / cycle"],
    ], {
        columns: [{ alignment: 'center' }, { alignment: 'right' }, { alignment: 'right' }],
        border: getBorderCharacters('norc')
    }).split('\n').join("\n" + " ".repeat(padding)).trim()

    const nativeRewardTable = table([
        ["", chalk.yellowBright("Current"), chalk.yellowBright("Proposed")],
        [`${chalk.yellowBright('Supply')} Side`, chalk.yellowBright(formatNumber(marketCalcs.currentNativeSupplyPerSecond, 4)) + " " + config.nativeTokenName + " /   sec", chalk.yellowBright(formatNumber(marketCalcs.proposedSupplyNativeTokensPerSecond, 4)) + " " + config.nativeTokenName + " /   sec"],
        [formatChange(changes.supplyNativeChange), chalk.yellowBright(formatNumber(marketCalcs.currentNativeSupplyPerSecond.times(ONE_DAY_IN_SECONDS), 4)) + " " + config.nativeTokenName + " /   day", chalk.yellowBright(formatNumber(marketCalcs.proposedSupplyNativeTokensPerSecond.times(ONE_DAY_IN_SECONDS), 4)) + " " + config.nativeTokenName + " /   day"],
        ["", chalk.yellowBright(formatNumber(marketCalcs.currentNativeSupplyPerSecond.times(ONE_DAY_IN_SECONDS).times(ONE_YEAR_IN_DAYS), 4)) + " " + config.nativeTokenName + " / cycle", chalk.yellowBright(formatNumber(marketCalcs.proposedSupplyNativeTokensPerSecond.times(ONE_DAY_IN_SECONDS).times(ONE_YEAR_IN_DAYS), 4)) + " " + config.nativeTokenName + " / cycle"],
        [`${chalk.yellowBright('Borrow')} Side`, chalk.yellowBright(formatNumber(marketCalcs.currentNativeBorrowPerSecond, 4)) + " " + config.nativeTokenName + " /   sec", chalk.yellowBright(formatNumber(marketCalcs.proposedBorrowNativeTokensPerSecond, 4)) + " " + config.nativeTokenName + " /   sec"],
        [formatChange(changes.borrowNativeChange), chalk.yellowBright(formatNumber(marketCalcs.currentNativeBorrowPerSecond.times(ONE_DAY_IN_SECONDS), 4)) + " " + config.nativeTokenName + " /   day", chalk.yellowBright(formatNumber(marketCalcs.proposedBorrowNativeTokensPerSecond.times(ONE_DAY_IN_SECONDS), 4)) + " " + config.nativeTokenName + " /   day"],
        ["", chalk.yellowBright(formatNumber(marketCalcs.currentNativeBorrowPerSecond.times(ONE_DAY_IN_SECONDS).times(ONE_YEAR_IN_DAYS), 4)) + " " + config.nativeTokenName + " / cycle", chalk.yellowBright(formatNumber(marketCalcs.proposedBorrowNativeTokensPerSecond.times(ONE_DAY_IN_SECONDS).times(ONE_YEAR_IN_DAYS), 4)) + " " + config.nativeTokenName + " / cycle"],
    ], {
        columns: [{ alignment: 'center' }, { alignment: 'right' }, { alignment: 'right' }], border: getBorderCharacters('norc')
    }).split('\n').join("\n" + " ".repeat(padding)).trim()

    return {
        govRewardTable, nativeRewardTable,
    }
}