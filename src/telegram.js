import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import configs from './config.js';
import fs from 'fs';

// Helper to check for required Telegram config from .env file
function checkTelegramConfig() {
    const {
        TELEGRAM_API_ID: apiId,
        TELEGRAM_API_HASH: apiHash,
        TELEGRAM_SESSION: session,
        BOOK_BOT_USERNAME: botUsername
    } = process.env;


    if (!apiId || !apiHash || !session || !botUsername) {
        throw new Error(`Telegram credentials are not configured in your .env file. Please ensure the following are set:
- TELEGRAM_API_ID
- TELEGRAM_API_HASH
- TELEGRAM_SESSION
- BOOK_BOT_USERNAME`);
    }
    return { apiId: parseInt(apiId, 10), apiHash, session, botUsername };
}

async function downloadFromBot(client, botEntity, command, bookData) {
    console.log(`[TELEGRAM] Sending download command: ${command}`);

    const downloadPromise = new Promise(async (resolve, reject) => {
        const timeout = setTimeout(() => {
            client.removeEventHandler(listener);
            reject(new Error("Timeout: Did not receive the book file from the bot after 60 seconds."));
        }, 60000);

        const listener = async (event) => {
            if (event.message.senderId.eq(botEntity.id) && event.message.document) {
                clearTimeout(timeout);
                client.removeEventHandler(listener);

                const downloadPath = configs.getDownloadPath();
                if (!fs.existsSync(downloadPath)) {
                    fs.mkdirSync(downloadPath, { recursive: true });
                }
                
                // Construct a filename from bookData to have more context
                const safeTitle = bookData.title.replace(/[.\\/:]/g, "").replace(/\s/g, "_");
                const extension = event.message.document.attributes.find(attr => attr.className === 'DocumentAttributeFilename')?.fileName.split('.').pop() || 'epub';
                const fileName = `${safeTitle}.${extension}`;
                const filePath = join(downloadPath, fileName);
                
                try {
                    console.log(`[TELEGRAM] Downloading file ${event.message.document.attributes[0].fileName}...`);
                    const fileBuffer = await client.downloadFile(event.message.media);
                    await writeFile(filePath, fileBuffer);
                    resolve({ success: true, path: filePath });
                } catch (error) {
                    reject(new Error(`Failed to download file: ${error.message}`));
                }
            }
        };
        
        client.addEventHandler(listener, new NewMessage({}));
        await client.sendMessage(botEntity.username, { message: command });
        console.log("Waiting for file download...");
    });

    return downloadPromise;
}


export async function downloadBookViaTelegram(bookData) {
    const { apiId, apiHash, session, botUsername } = checkTelegramConfig();

    const client = new TelegramClient(new StringSession(session), apiId, apiHash, { connectionRetries: 5 });
    
    let success = false;
    try {
        console.log('[TELEGRAM] Connecting to client...');
        await client.start({
            onError: (err) => {
                console.error("[TELEGRAM] Login error:", err)
                throw err;
            }
        });
        console.log('✅ [TELEGRAM] Successfully connected!');

        const dialogs = await client.getDialogs({});
        const botEntity = dialogs.find(d => d.entity.username?.toLowerCase() === botUsername.toLowerCase())?.entity;

        if (!botEntity) {
            throw new Error(`Could not find a chat with "@${botUsername}". Please start a chat with it first in your Telegram account.`);
        }
        console.log(`✅ [TELEGRAM] Found bot: ${botEntity.title} (@${botEntity.username})`);
        
        // Convert book ID and hash to bot command
        const command = `/book${bookData.id}_${bookData.hash}`;
        
        const result = await downloadFromBot(client, botEntity, command, bookData);
        if (result.success) {
            console.log(`✅ [TELEGRAM] Successfully downloaded book to: ${result.path}`);
            success = true;
        }

    } catch (error)
     {
        console.error("❌ [TELEGRAM] An error occurred:", error.message);
        throw error; // Re-throw to be caught by the menu
    } finally {
        if (client.connected) {
            console.log("[TELEGRAM] Disconnecting client...");
            await client.disconnect();
        }
    }
    return success;
}