import {COMPONENT, DefaultConfig, MARKET_SIDE, NETWORK, REWARD_TYPE} from "./types";
import {Contracts} from "@moonwell-fi/moonwell.js";
import {omit} from "lodash";
import {BigNumber} from "bignumber.js";

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

        ecosystemReserve: '0xbA17581Bb6d89954B42fB84294e476e97588908B',
        treasuryAddress: '0x45DD368E30C07804b037260071d332e547C874F0',

        dexPoolID: 11,

        submissionRewardAmount: 250_000,

        // The default percentage splits, should be in decimal (ex 30% would be 0.3)
        defaultSplits: {
            [COMPONENT.ALL_MARKETS]: 0.30,
            [COMPONENT.SAFETY_MODULE]: 0.33,
            [COMPONENT.DEX_REWARDER]: 0.37,
        },

        // The default grant sizes, denominated in underlying tokens as whole numbers (no mantissa)
        defaultGrantAmounts: {
            // 50% of MFAM supply or 500M MFAM emitted over 2 years since 2/23/2022
            // ~186,912,704 MFAM remaining to be emitted as of 3/14/2023
            // There are 48 weeks remaining in the 2nd year from 2/23/2023 to 2/23/2024
            [REWARD_TYPE.GOV_TOKEN]: new BigNumber(186_912_704) // 186,912,704 in total remaining
                                            .div(48) // 48 weeks left in the year
                                            .times(4) // 4 weeks per reward cycle
                                            .integerValue(BigNumber.ROUND_DOWN)
                                            .toNumber(), // MFAM
            [REWARD_TYPE.NATIVE_TOKEN]: 2_481.5, // MOVR
        },

        // The default percentage splits, should be in decimal (ex 30% would be 0.3)
        defaultBorrowSupplySplit: {
            [MARKET_SIDE.SUPPLY]: 1,
            [MARKET_SIDE.BORROW]: 0,
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

        ecosystemReserve: '0x7793E08Eb4525309C46C9BA394cE33361A167ba4',
        treasuryAddress: '0x6972f25AB3FC425EaF719721f0EBD1Cdb58eE451',

        dexPoolID: 15,

        submissionRewardAmount: 50_000,

        // The default percentage splits, should be in decimal (ex 30% would be 0.3)
        defaultSplits: {
            [COMPONENT.ALL_MARKETS]: 0.47,
            [COMPONENT.SAFETY_MODULE]: 0.47,
            [COMPONENT.DEX_REWARDER]: 0.6,
        },

        // The default grant sizes, denominated in underlying tokens as whole numbers (no mantissa)
        defaultGrantAmounts: {
            // WELL rewards => 750,000,000 WELL / 4 years / 364 days * 28 days in a period = per period emissions
            [REWARD_TYPE.GOV_TOKEN]: new BigNumber(750_000_000)
                                        .div(4)
                                        .div(364)
                                        .times(28)
                                        .integerValue(BigNumber.ROUND_DOWN)
                                        .toNumber(),
            [REWARD_TYPE.NATIVE_TOKEN]: 262_808.9, // GLMR, based on tranche 2 grant
        },

        // The default percentage splits, should be in decimal (ex 30% would be 0.3)
        defaultBorrowSupplySplit: {
            [MARKET_SIDE.SUPPLY]: 1,
            [MARKET_SIDE.BORROW]: 0,
        },

        toJSON(){
            return omit(this, [ "contracts", "nativeAsset" ]);
        }
    },
}

export default defaultConfig