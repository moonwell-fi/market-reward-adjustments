import {ContractBundle, Market} from "@moonwell-fi/moonwell.js";

export enum NETWORK {
    MOONRIVER = "Moonriver",
    MOONBEAM = "Moonbeam",
}

export enum COMPONENT {
    ALL_MARKETS = "ALL_MARKETS",
    SAFETY_MODULE = "SAFETY_MODULE",
    DEX_REWARDER = "DEX_REWARDER",
}

export enum REWARD_TYPE {
    GOV_TOKEN,
    NATIVE_TOKEN,
}

export type DefaultSplitConfig = {
    [COMPONENT.ALL_MARKETS]: number
    [COMPONENT.SAFETY_MODULE]: number
    [COMPONENT.DEX_REWARDER]: number
}

export type DefaultGrantConfig = {
    [REWARD_TYPE.GOV_TOKEN]: number
    [REWARD_TYPE.NATIVE_TOKEN]: number
}

export type NetworkSpecificConfig = {
    rpc: string
    govTokenName: string
    nativeTokenName: string
    networkName: string
    dexName: string
    govTokenUniPoolAddress: string
    defaultSplits: DefaultSplitConfig
    defaultGrantAmounts: DefaultGrantConfig
    contracts: ContractBundle
    nativeAsset: Market
    toJSON: Function

}

export type DefaultConfig = {
    daysPerRewardCycle: number
    [NETWORK.MOONRIVER]: NetworkSpecificConfig
    [NETWORK.MOONBEAM]: NetworkSpecificConfig
}