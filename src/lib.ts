import {BigNumber} from "bignumber.js";

export function formatNumber(num: string | BigNumber, truncate = 2){
    const truncated = new BigNumber(num).toFixed(truncate)
    return parseFloat(truncated).toLocaleString(undefined, {minimumFractionDigits: truncate, maximumFractionDigits: truncate})
}