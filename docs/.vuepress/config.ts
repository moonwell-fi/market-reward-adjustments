import { defineConfig } from "vuepress/config";

export default defineConfig({
    title: "Moonwell Reward Adjustments",
    base: "/market-reward-adjustments/",
    themeConfig: {
        repo: 'moonwell-fi/market-reward-adjustments',
        nav: [
            { text: 'Home', link: '/' },
            { text: 'Moonwell Governance', link: 'https://gov.moonwell.fi' }
        ]
    },
});
