import {COMPONENT, DefaultConfig, NETWORK, REWARD_TYPE} from "../src/types";
import {Contracts} from "@moonwell-fi/moonwell.js";
import {omit} from "lodash";

const defaultConfig: DefaultConfig = {
    // Days to use as 1 reward cycle
    daysPerRewardCycle: 28,

    // Network specific configurations (RPC, gov token name, etc)
    [NETWORK.MOONRIVER]: {
        rpc: 'https://rpc.api.moonriver.moonbeam.network',
        govTokenName: "MFAM",
        nativeTokenName: "MOVR",
        networkName: "Moonriver",
        dexName: "SolarBeam",
        govTokenUniPoolAddress: '0xE6Bfc609A2e58530310D6964ccdd236fc93b4ADB',
        contracts: Contracts.moonriver,
        nativeAsset: Contracts.moonriver.MARKETS['MOVR'],

        // The default percentage splits, should be in decimal (ex 30% would be 0.3)
        defaultSplits: {
            [COMPONENT.ALL_MARKETS]: 0.28,
            [COMPONENT.SAFETY_MODULE]: 0.23,
            [COMPONENT.DEX_REWARDER]: 0.49,
        },

        // The default grant sizes, denominated in underlying tokens as whole numbers (no mantissa)
        defaultGrantAmounts: {
            [REWARD_TYPE.GOV_TOKEN]: 28_000_000,    // MFAM
            [REWARD_TYPE.NATIVE_TOKEN]: 9_926, // MOVR
        },

        toJSON(){
            return omit(this, [ "contracts", "nativeAsset" ]);
        }
    },
    [NETWORK.MOONBEAM]: {
        rpc: 'https://rpc.api.moonbeam.network',
        govTokenName: "WELL",
        nativeTokenName: "GLMR",
        networkName: "Moonbeam",
        govTokenUniPoolAddress: '0xb536c1f9a157b263b70a9a35705168acc0271742',
        contracts: Contracts.moonbeam,
        nativeAsset: Contracts.moonbeam.MARKETS['GLMR'],
        dexName: "StellaSwap",

        // The default percentage splits, should be in decimal (ex 30% would be 0.3)
        defaultSplits: {
            [COMPONENT.ALL_MARKETS]: 0.30,
            [COMPONENT.SAFETY_MODULE]: 0.42,
            [COMPONENT.DEX_REWARDER]: 0.28,
        },

        // The default grant sizes, denominated in underlying tokens as whole numbers (no mantissa)
        defaultGrantAmounts: {
            [REWARD_TYPE.GOV_TOKEN]: 15_625_000, // WELL 750,000,000 / 4 years / 12 months == static per month emissions
            [REWARD_TYPE.NATIVE_TOKEN]: 500_000, // GLMR
        },
        toJSON(){
            return omit(this, [ "contracts", "nativeAsset" ]);
        }
    },
}

export default defaultConfig