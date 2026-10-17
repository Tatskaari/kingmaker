import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests',testMatch:'**/*.spec.ts',use:{baseURL:'http://127.0.0.1:4178',viewport:{width:1600,height:1000}},webServer:{command:'node build.mjs --serve --port=4178',url:'http://127.0.0.1:4178',reuseExistingServer:false},reporter:'list'});
