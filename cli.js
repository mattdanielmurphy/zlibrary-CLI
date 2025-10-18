#!/usr/bin/env node
import 'dotenv/config';
import menus from './src/menu.js';

const args = process.argv.slice(2);

async function main() {
    if (args.length > 0) {
        const searchTerm = args.join(' ');
        await menus.directSearch(searchTerm);
    } else {
        menus.startMenu();
    }
}

main();