import {BigNumber} from "bignumber.js";
import {Contract} from "ethers";

export function formatNumber(num: string | BigNumber, truncate: number = 2){
    const bigNum = new BigNumber(num)
    // If we have an asset worth less than 1 dollar and no specified truncation, truncate to 4 digits
    if (bigNum.isLessThan(1) && truncate === 2){
        truncate = 4
    }

    // If we have something smaller than 0.000001, treat it as 0 for formatting
    if (bigNum.shiftedBy(6).integerValue().isZero()){
        truncate = 0
    }

    const truncated = new BigNumber(num).toFixed(truncate)
    return parseFloat(truncated).toLocaleString(undefined, {minimumFractionDigits: truncate, maximumFractionDigits: truncate})
}

export async function addProposalToPropData(contract: Contract, fn: string, args: any[], proposalData: any){
    const tx = await contract.populateTransaction[fn](...args)

    proposalData.targets.push(contract.address)
    proposalData.values.push(0)
    proposalData.signatures.push(contract.interface.getFunction(fn).format())
    proposalData.callDatas.push('0x' + tx.data!.slice(10)) // chop off the method selector from the args
}