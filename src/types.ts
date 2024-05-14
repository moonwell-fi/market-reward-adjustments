import { ContractBundle, Market } from "@moonwell-fi/moonwell.js";

export enum NETWORK {
    MOONRIVER = "Moonriver",
    MOONBEAM = "Moonbeam",
}

export enum MARKET_SIDE {
    SUPPLY = "SUPPLY",
    BORROW = "BORROW",
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

export type DefaultSupplyBorrowSplit = {
    [MARKET_SIDE.SUPPLY]: number
    [MARKET_SIDE.BORROW]: number
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
    defaultBorrowSupplySplit: DefaultSupplyBorrowSplit
    toJSON: Function

    treasuryAddress: string
    ecosystemReserve: string
    dexPoolID: number

    submissionRewardAmount: number
}

export type DefaultConfig = {
    daysPerRewardCycle: number
    [NETWORK.MOONRIVER]: NetworkSpecificConfig
    [NETWORK.MOONBEAM]: NetworkSpecificConfig
}

export type MetaConfig = {
    generatedAt: string,
    generatorVersion: string
}

export type SafetyModuleEmissions = {
    emissionsPerSecond: string
    lastUpdateTimestamp: number
    emissionAPR: string
    emissionsPerYear: string
}
export type SafetyModuleInfo = {
    totalStaked: string
    stakedTVL: string
    govTokenPrice: string
    emissions: SafetyModuleEmissions
}

export type DexPoolRewardInfo = {
    startTimestamp: number
    endTimestamp: number
    rewardPerSec: string
}

export type DexInfo = {
    govTokenTotal: string
    nativeAssetTotal: string
    govTokenPrice: string
    nextFreeSlot: number
    emissionsPerYear: string
    poolTVL: string
    currentPoolAPR: string
    currentPoolRewardInfo: DexPoolRewardInfo
}

export type SupplyBorrowSplit = {
    [key in REWARD_TYPE]: string
}

export type AssetData = {
    price: string
    totalSuppliedUnderlying: string
    totalSuppliedTVL: string
    totalBorrows: string
    totalBorrowedTVL: string
    utilization: string
    govSupplySpeed: string
    govBorrowSpeed: string
    nativeSupplySpeed: string
    nativeBorrowSpeed: string
    supplyBorrowSplit: SupplyBorrowSplit
}

export type Assets = {
    [key: string]: AssetData
}

export type RewardSplits = {
    [key: string]: number
}

export type MarketData = {
    assets: Assets
    totalTVL: string
    govRewardSplits: RewardSplits
    nativeRewardSplits: RewardSplits
}

export type GlobalConfig = {
    daysPerRewardCycle: number
    rpc: string
    govTokenName: string
    nativeTokenName: string
    networkName: string
    govTokenUniPoolAddress: string
    dexName: string
}

export type ComponentSplits = {
    [key in COMPONENT]: number
}

export type Responses = {
    name: string
    network: string
    mipNumber: number
    componentSplits: ComponentSplits
    emissionAmounts: { [key in REWARD_TYPE]: number }
    submitterWallet: string
}

export type MipConfig = {
    _meta: MetaConfig
    snapshotBlock: number
    safetyModuleInfo: SafetyModuleInfo
    "dexInfo": DexInfo
    "marketData": MarketData,
    "config": GlobalConfig,
    "responses": Responses
}