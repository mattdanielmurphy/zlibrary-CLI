import configs from "./config.js";
import menus from './menu.js';
import requests from "./request.js";

/**
 * Rate limiting delay between API requests
 * @param {number} ms - milliseconds to wait (default 500ms)
 */
async function rateLimitDelay(ms = 500) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getPrivateDomain(){
	// Note: private domains no longer seem to be used
	/*
	const response = await requests.GETRequest(configs.getMirror(true) + "/");

	const domainsKeyword = 'const domains';
	const domainsString = new RegExp(`${domainsKeyword}\\s*=\\s*(.*)`)
		.exec(response.data)[1]
		.replace(/(['"])?([a-z0-9A-Z_]+)(['"])?:/g, '"$2": ')
	const domains = JSON.parse(domainsString); // { books: [...], articles: [...] }
	configs.setPersonalDomain("https://" + domains.books[0]);
	return true;
	*/

}
/**
 * @params username {string}
 * @params password {string}
 */
async function login(email, password){
	const response = await requests.POSTRequest("/eapi/user/login", {email, password});	
	if(response.data.success != 1){
		await menus.errorPrompt(JSON.stringify(response.data))
		return false;
	}
	configs.login(response.data.user.id.toString(), response.data.user.remix_userkey);
	//await getPrivateDomain();
	return true;
}
async function tokenLogin(id, token){
	configs.login(id, token);
	await getPrivateDomain();
	return true;
}
async function search(searchData){
	const response = await requests.POSTRequest("/eapi/book/search", searchData);
	if(response.data.success != 1){
		await menus.errorPrompt(JSON.stringify(response.data))
		return false;
	}
	return response.data;
}
function logout(){
	configs.logout();
	return true;
}
async function getDownloadLink(id, hash){
	let response = (await requests.GETRequest(`/eapi/book/${id}/${hash}/file`)).data;
	if(!response.file){
		return false;
	}
	response.filename = configs.getDownloadPath() + "/" + response.file.description.replaceAll(/\.| |\\|\/|\:/g, "") + "." + response.file.extension; 
	console.log(response);
	return response;
}
async function downloadFile(url){
	// Add rate limiting delay before download
	await rateLimitDelay();
	
	let response = await requests.download(url);
	return Buffer.from(response.data, 'binary');
}

/**
 * Gets book details including available formats
 * @param {number} id - Book ID
 * @param {string} hash - Book hash
 * @returns {object} book details with formats
 */
async function getBookDetails(id, hash){
	try {
		const response = await requests.GETRequest(`/eapi/book/${id}/${hash}`);
		if (response.data && response.data.success === 1) {
			return response.data;
		}
		return null;
	} catch (error) {
		console.log('Error getting book details:', error.message);
		return null;
	}
}

/**
 * Searches for books and returns raw results without user interaction
 * @param {object} searchData - Search parameters
 * @returns {object|null} search results or null if failed
 */
async function searchBooks(searchData) {
	try {
		// Add rate limiting delay before search
		await rateLimitDelay();
		
		const response = await requests.POSTRequest("/eapi/book/search", searchData);
		if(response.data.success === 1){
			return response.data;
		}
		return null;
	} catch (error) {
		console.log('Search error:', error.message);
		return null;
	}
}

/**
 * Gets detailed format information for a book with minimal debugging
 * @param {number} id - Book ID  
 * @param {string} hash - Book hash
 * @returns {object|null} detailed format info with debugging
 */
async function getDetailedFormatInfo(id, hash) {
	try {
		// Add rate limiting delay before format check
		await rateLimitDelay();
		
		// Try to get download link - this will show available formats
		const response = await requests.GETRequest(`/eapi/book/${id}/${hash}/file`);
		
		if (!response.data || response.data.success !== 1) {
			console.log(`    ❌ API call failed: success=${response.data?.success}, message=${response.data?.message || 'unknown'}`);
			return null;
		}
		
		if (!response.data.file) {
			console.log(`    ❌ No file data in response`);
			return null;
		}
		
		const file = response.data.file;
		
		// Check for daily download limit
		if (file.allowDownload === false) {
			const message = file.disallowDownloadMessage || 'Daily download limit reached';
			throw new Error(`DAILY_LIMIT_REACHED: ${message}`);
		}
		
		const extension = file.extension?.toLowerCase();
		const originalExtension = file.extension;
		
		// Check if it's EPUB or MOBI (case insensitive)
		if (extension === 'epub' || extension === 'mobi') {
			return {
				downloadLink: file.downloadLink,
				extension: extension,
				filename: file.description?.replace(/[<>:"/\\|?*]/g, '') + '.' + extension,
				originalExtension: originalExtension,
				fileSize: file.size
			};
		} else {
			console.log(`    ❌ Unsupported format: "${extension}" (original: "${originalExtension}")`);
			return null;
		}
		
	} catch (error) {
		// Re-throw daily limit errors
		if (error.message.includes('DAILY_LIMIT_REACHED')) {
			throw error;
		}
		console.log(`    ❌ Error getting format info: ${error.message}`);
		return null;
	}
}

/**
 * Finds the best format (EPUB preferred, MOBI as fallback) for a book
 * @param {number} id - Book ID  
 * @param {string} hash - Book hash
 * @returns {object|null} download info for preferred format
 */
async function getPreferredFormat(id, hash) {
	const detailedInfo = await getDetailedFormatInfo(id, hash);
	if (detailedInfo) {
		// Return in the expected format for backward compatibility
		return {
			downloadLink: detailedInfo.downloadLink,
			extension: detailedInfo.extension,
			filename: detailedInfo.filename
		};
	}
	return null;
}

export default {login, logout, search, getDownloadLink, downloadFile, tokenLogin, getPrivateDomain, getBookDetails, searchBooks, getPreferredFormat, getDetailedFormatInfo};
