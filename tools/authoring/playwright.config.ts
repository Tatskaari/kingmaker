import {defineConfig} from '@playwright/test';
// The harness is served on a port of its own for the tests: 4178, or KINGMAKER_HARNESS_PORT (another checkout's tests may hold 4178).
const port=Number(process.env.KINGMAKER_HARNESS_PORT??4178);
export default defineConfig({testDir:'tests',testMatch:'**/*.spec.ts',use:{baseURL:`http://127.0.0.1:${port}`,viewport:{width:1600,height:1000}},webServer:{command:`node build.mjs --serve --port=${port}`,url:`http://127.0.0.1:${port}`,reuseExistingServer:false},reporter:'list'});
