# Moonwell Market Reward Automation 

The Moonwell Market Reward Automation tool is a tool designed to automate the market reward emissions in a sane, repeatable,
and verifiable way.

# Installation

The tool is hosted on [NPM](https://www.npmjs.com/package/@moonwell-fi/market-reward-adjuster) and can be installed just
like any other node package.

It is recommended to run this tool inside docker to hedge against the risk of malicious supply chains or other comprimises.

You can use the following command to start a new docker container with the local directory mounted, then follow the other
installation instructions to use the tool.

If you prefer not to use docker, simply skip the first step below, though it's highly recommended.

```shell
$ docker run --rm -it -v $(pwd):$(pwd) --workdir $(pwd) node:lts bash
$ npm install -g @moonwell-fi/market-reward-adjuster
```

# Usage

Once you have the reward adjuster installed, you will have 2 new command line utilities at your disposal
  - `moonwell-config-generator` will prompt you with a few questions about which network you're on, the amount of 
    tokens to disburse, etc and generate you a config file with all relevant market data needed to generate a proposal.
    No arguments are necessary for this command. The default output will weight rewards based on TVL.
  - `moonwell-proposal-generator` will read in a config file that's generated by `moonwell-config-generator` and display
    and generate a proposal with an outline of what it does that can be put on-chain. The only argument you should need
    for this tool is a path to the generated config file.

The idea is that you run `moonwell-config-generator` to generate a config, tweak it as needed, then use `moonwell-proposal-generator`
to generate the artifacts that you need to upload to the gov portal to put the proposal on-chain. 

There are a number of sections in the config file that are adjustable, though this process needs to be improved IMO. ONLY
update the following things in the generated config file:

- `marketData.govRewardSplits` - governs weighting for gov reward tokens per market. Must add up to 1
- `marketData.nativeRewardSplits` - governs weighting for native reward tokens per market. Must add up to 1
- `marketData.assets.[*].nativeSupplyBorrowSplit` - governs how much weight the borrow and supply side has of the share
  of tokens it's given in `marketData.nativeRewardSplits`. Must add up to 1
- `marketData.assets.[*].govSupplyBorrowSplit` - governs how much weight the borrow and supply side has of the share
  of tokens it's given in `marketData.govSupplyBorrowSplit`. Must add up to 1

Once you've made any of these weighting tweaks desired, you can run `moonwell-proposal-generator MIP-xxx.json`, which will
print out a summary of the proposal/adjustments, and write out the following files:
- `MIP-xxx-description.md` - The markdown of the proposal itself
- `MIP-xxx-proposal.json` - The proposal JSON *with the markdown embedded in it* which should be submitted to the gov portal.

