import Enquirer from 'enquirer';
import api from './api.js';
import batchDownload from './batch-download.js';
import configs from './config.js';
import { downloadBookViaTelegram } from './telegram.js';
import fs from 'fs';
import open from 'open';
import vimShortcuts from './vim-shortcuts.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Formats a number of bytes into a human-readable string.
 * @param {number} bytes - The number of bytes.
 * @param {number} decimals - Number of decimal places.
 * @returns {string} Human-readable size string.
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0 || typeof bytes !== 'number') return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Truncates a string to a maximum length and appends an ellipsis if truncated.
 * @param {string} str - The string to truncate.
 * @param {number} length - The maximum length.
 * @returns {string} The truncated string.
 */
function truncate(str, length) {
    if (str.length <= length) {
        return str;
    }
    return str.substring(0, length) + '...';
}

async function startMenu(){
	console.clear();
	let accountPrompt = configs.isLoggedIn()?'Sign out':'Log in';
	const prompt = new Enquirer.Select({
		name: 'startmenu',
		message: 'What would you like to do?',
		choices: [accountPrompt, "Search Z-Library", "Batch download from JSON", "Browse downloaded books", "settings"],
		actions:vimShortcuts
	});
	let result = await prompt.run();
	switch(result){
		case "Sign out": 
			api.logout();
			startMenu();
			break;
		case "Log in":
			loginOptions();
			break;
		case "Search Z-Library":
			await searchMenu();
			break;
		case "Batch download from JSON":
			await batchDownloadMenu();
			break;
		case "Browse downloaded books":
			openDownloads();
			break;
		case "settings":
			settingsMenu();
			break;
	}
}
async function settingsMenu(){
	try {
		const prompt = new Enquirer.Form({
			name:"settingPrompt",
			message:"User settings",
			choices:[
				{name:"downloadPath",message:"Book download path", initial:configs.getDownloadPath()},
				{name:"domain", message:"Public domain (eg. singlelogin.me)", initial:configs.getMirror(true)},
				{name:"personalDomain", message:"Personal domain", initial:configs.getMirror()},
				{name:"defaultExtensions", message:"Default search extensions (Valid: txt,pdf,fb2,epub,lit,mobi,rtf,djv,djvu,azw,azw3)", initial:configs.getDefaultExtensions()},
				{name:"defaultLanguages", message:"Default search languages (comma separated)", initial:configs.getDefaultLanguages()}
			]
		});
		const response = await prompt.run();
		configs.saveSettings(response);
	} catch (e) {
		// User cancelled the prompt (e.g., pressed Esc)
		// Do nothing, just proceed to startMenu
	}
	await startMenu();
}
async function loginOptions(){
	console.clear();
	let result;
	try {
		const prompt = new Enquirer.Select({
			name: "loginMenu",
			message: "What would you like to do?",
			choices: ["Log in", "Log in with user key", "Update personal domain", "Back"],
			actions:vimShortcuts	
		});
		result = await prompt.run();
	} catch (e) {
		startMenu();
		return;
	}
	
	switch(result){
		case "Back": 
			startMenu();
			break;
		case "Log in":
			loginMenu();
			break;
		case "Log in with user key":
			tokenLoginMenu();
			break;
		case "Update personal domain":
			await api.getPrivateDomain();
			await startMenu();
			break;
	}
}
async function loginMenu(){
	console.clear();
	try {
		const prompt = new Enquirer.Form({
			name: "loginForm",
			message:"Login to Z-Library",
			choices: [
				{name: "mail", type: "input", message: "E-Mail", initial:"johndoe@example.com"},
				{name:"password", type: "password", message: "Password", initial:"your password"}
			]
		})
		const response = await prompt.run();
		await api.login(response.mail, response.password);
	} catch (e) {
		// User cancelled, return to login options
	}
	startMenu();
}
async function tokenLoginMenu(){
	console.clear();
	try {
		const prompt = new Enquirer.Form({
			name: "tokenLoginForm",
		message:"Log in with session token",
			choices: [
				{name:"id", type: "input", message:"Remix user id"},
				{name:"token", type: "input", message:"Remix user token"}
			]
		});
		const response = await prompt.run();
		await api.tokenLogin(response.id, response.token);
	} catch (e) {
		// User cancelled, return to login options
	}
	startMenu();
}

async function openDownloads(){
	open(configs.getDownloadPath());
	await startMenu();
}
/**
 * @param error {string}
 */
async function errorPrompt(error){
	const prompt = new Enquirer.Toggle({
		message: "Error: " + error,
		enabled:"Ok",
		disabled: "Ok"
	});
	await prompt.run();
}
async function searchMenu(){
	let answer;
	try {
		const prompt = new Enquirer.Form({
			name:"searchForm",
			message:"Search Z-Library",
			choices: [
				{name:"message", message:"Search term", initial:""},
				{name:"yearFrom", message:"Start year", initial:"0"},
				{name:"yearTo", message:"End year", initial:String(new Date().getFullYear())},
				{name:"languages", message:"Languages", initial:configs.getDefaultLanguages()},
				{name:"extensions", message:"Searched extensions", initial:configs.getDefaultExtensions()}

			]
		});
		answer = await prompt.run();
	} catch (e) {
		await startMenu();
		return;
	}
	
	answer.languages = answer.languages.split(",");
	answer.extensions = answer.extensions.split(",");
	answer.limit = 50
	answer.order = "popular";
	const response = await api.search(answer);
	try{
		await bookListMenu(response, answer);
	}
	catch(err){
		if (err && err.message !== 'search cancelled') console.error(err);
		await searchMenu();
	}
}

/**
 * Displays a menu of actions for a selected book.
 * @param {object} bookData - The book object with fetched details (extension, size).
 * @param {object} searchParams - The original search parameters.
 */
async function bookActionMenu(bookData, searchParams) {
	console.clear();
	console.log(`--- ${bookData.title} by ${bookData.author} ---`);
	console.log(`Format: ${bookData.extension.toUpperCase()} | Size: ${bookData.size}`);
	console.log("--------------------------------------");

	const prompt = new Enquirer.Select({
		message: "Select action",
		name: "action",
		choices: ["Telegram Download", "Standard Download", "View Full Details", "Back to List"],
	});

	let answer;
	try {
		answer = await prompt.run();
	} catch (e) {
		// User cancelled the prompt (Esc), treat as 'Back to List'
		return;
	}

	if (answer === "Back to List") {
		return;
	}

	if (answer === "View Full Details") {
		await viewBook(bookData); // Show full details
		await bookActionMenu(bookData, searchParams); // Return to action menu
		return;
	}

	if (answer === "Standard Download") {
		await downloadMenu(bookData.id, bookData.hash);
		return;
	}

	if (answer === "Telegram Download") {
		try {
			await downloadBookViaTelegram(bookData);
			console.log("\n✅ Telegram download complete!");
			await sleep(2000);
			await startMenu();
		} catch (e) {
			await errorPrompt(e.message);
			await bookActionMenu(bookData, searchParams); // Go back to action menu on error
		}
		return;
	}
}

/**
 * Displays the full book details.
 * @param {object} bookData - The book object.
 */
async function viewBook(bookData){
	console.clear();
	let displayData = "";
	for(let data in bookData){
		displayData += `${data}: ${bookData[data]}\n`
	}
	console.log(displayData);

	const prompt = new Enquirer.Toggle({
		message: "Press Enter to return to the action menu.",
		enabled: "Ok",
		disabled: "Ok"
	});
	
	try {
		await prompt.run();
	} catch (e) {
		// Esc/Cancel is fine, just return
	}
}

/**
 * Displays a multi-select menu for choosing file extensions.
 * @param {object} searchParams - The current search parameters.
 * @returns {Promise<string[]>} A promise that resolves to an array of selected extensions.
 */
async function filetypesMenu(searchParams) {
	console.clear();
	const allExtensions = configs.getAllExtensions().split(',');
	const currentExtensions = searchParams.extensions;

	// Create choices with the current extensions pre-selected
	const choices = allExtensions.map(ext => ({
		name: ext.toUpperCase(),
		value: ext,
		checked: currentExtensions.includes(ext),
	}));

	try {
		const prompt = new Enquirer.MultiSelect({
			name: 'extensions',
			message: 'Select file extensions to search (Space to toggle, Enter to confirm)',
			choices: choices,
			actions: vimShortcuts,
		});

		const selectedExtensions = await prompt.run();
		return selectedExtensions;
	} catch (e) {
		// User cancelled the prompt (Esc)
		return null;
	}
}

async function bookListMenu(bookList, searchParams){
	const pageSize = 15;
	let currentPage = 0;
	const totalBooks = bookList.books.length;
	const totalPages = Math.ceil(totalBooks / pageSize);
	const currentExtension = searchParams.extensions.join(',').toUpperCase();
	const nextExtension = currentExtension === 'EPUB' ? 'MOBI' : 'EPUB'; // Simple toggle for now
	let lastSelectedGlobalIndex = '0'; // Track the last selected index

	while (true) {
		console.clear(); // Re-introduce clear for dynamic update to work (accepting the flicker)
		const start = currentPage * pageSize;
		const end = start + pageSize;
		const booksOnPage = bookList.books.slice(start, end);

		const promptChoices = booksOnPage.map((book, index) => {
			const globalIndex = start + index;
			const truncatedTitle = truncate(book.title, 70);
			let message = `${globalIndex + 1}| ${truncatedTitle} by ${book.author}`;
			
			// Add size/extension if already fetched (from a previous selection)
			if (book.extension && book.size) {
				message += ` (${book.extension.toUpperCase()}) | ${book.size}`;
			}
			
			return {
				name: String(globalIndex),
				value: String(globalIndex),
				message: message
			};
		});

		// Add navigation options
		const navigationChoices = [];
		if (currentPage > 0) {
			navigationChoices.push({ name: 'prev', message: '<< Previous Page' });
		}
		if (currentPage < totalPages - 1) {
			navigationChoices.push({ name: 'next', message: '>> Next Page' });
		}
		
		// Add the new search option
		navigationChoices.push({ name: 're_search', message: `Search for .${nextExtension.toLowerCase()}` });
		// Add the new search for all types option, which can be customized
		navigationChoices.push({ name: 're_search_custom', message: 'Search for custom filetypes' });
		
		navigationChoices.push({ name: 'cancel', message: 'Cancel Search' });

		const prompt = new Enquirer.Select({
			name: 'book',
			message: `Which book do you want to view? (Page ${currentPage + 1}/${totalPages}) - Current Extension: ${currentExtension}`,
			initial: lastSelectedGlobalIndex, // Use the tracked index
			choices: [...promptChoices, ...navigationChoices],
			actions: vimShortcuts
		});

		let postToView;
		try {
			postToView = await prompt.run();
		} catch (e) {
			// User cancelled the prompt (Esc)
			throw new Error('search cancelled');
		}

		// Update the last selected index if a book was chosen
		if (!['next', 'prev', 'cancel', 're_search', 're_search_custom'].includes(postToView)) {
			lastSelectedGlobalIndex = postToView;
		}

		if (postToView === 'next') {
			currentPage++;
		} else if (postToView === 'prev') {
			currentPage--;
		} else if (postToView === 'cancel') {
			throw new Error('search cancelled');
		} else if (postToView === 're_search') {
			// Re-run search with the new extension
			console.log(`\nRe-running search for .${nextExtension.toLowerCase()}...`);
			const newSearchParams = { ...searchParams, extensions: [nextExtension.toLowerCase()] };
			const newResponse = await api.search(newSearchParams);
			if (newResponse) {
				// Start a new book list menu with the new results and parameters
				await bookListMenu(newResponse, newSearchParams);
				return; // Exit the current loop/function
			}
		} else if (postToView === 're_search_custom') {
			// Open the multi-select menu for custom extensions
			const selectedExtensions = await filetypesMenu(searchParams);

			if (selectedExtensions && selectedExtensions.length > 0) {
				console.log(`\nRe-running search for extensions: ${selectedExtensions.join(', ')}...`);
				const newSearchParams = { ...searchParams, extensions: selectedExtensions };
				const newResponse = await api.search(newSearchParams);
				if (newResponse) {
					// Start a new book list menu with the new results and parameters
					await bookListMenu(newResponse, newSearchParams);
					return; // Exit the current loop/function
				}
			} else if (selectedExtensions && selectedExtensions.length === 0) {
				// User selected 0 extensions, show error and continue
				await errorPrompt("You must select at least one file extension.");
				continue;
			} else {
				// User cancelled the filetypes menu, re-show the book list menu
				continue;
			}
		} else {
			// A book was selected
			const selectedBook = bookList.books[postToView];
			
			// 1. Check if details are already fetched
			if (!selectedBook.extension || !selectedBook.size) {
				console.log(`\nFetching details for book ${parseInt(postToView) + 1}...`);
				
				// Fetch details using getBookDetails to get filesizeString and extension
				const bookDetailsResponse = await api.getBookDetails(selectedBook.id, selectedBook.hash);
				
				if (bookDetailsResponse && bookDetailsResponse.book) {
					const details = bookDetailsResponse.book;
					
					// Merge the new details into the selectedBook object
					Object.assign(selectedBook, details);
					
					// Use the fetched properties
					selectedBook.extension = details.extension || 'N/A';
					selectedBook.size = details.filesizeString || formatBytes(details.filesize);
					
					// Re-render the list to show the new details
					continue; 
				} else {
					await errorPrompt("Could not fetch file details for this book.");
					continue;
				}
			}
			
			// 2. Details are present, show action menu
			await bookActionMenu(selectedBook, searchParams);
			// When bookActionMenu returns, we continue the loop to re-render the list
		}
	}
}

async function downloadMenu(id, hash){
	console.clear();
	console.log("Fetching download link..");
	const downloadData = await api.getDownloadLink(id, hash, true);
	if(!downloadData || !downloadData.success == 1){
		console.log("Error", downloadData);
		await sleep(2000);
		throw new Error("downloadError");
	}
	console.log("Downloading file..");
	console.log("0%");
	const fileData = await api.downloadFile(downloadData.file.downloadLink);
	console.log("100%");

	let isDirectoryCreated = fs.existsSync(configs.getDownloadPath())
	if(!isDirectoryCreated){
		fs.mkdirSync(configs.getDownloadPath(), { recursive: false })
	}
	console.log("Saving file..");
	fs.writeFileSync(configs.getDownloadPath() + "/" + downloadData.filename, fileData);
	await startMenu();
	
}

/**
 * Menu for batch downloading books from JSON file
 */
async function batchDownloadMenu() {
	console.clear();
	
	// Check if user is logged in
	if (!configs.isLoggedIn()) {
		await errorPrompt('You must be logged in to download books. Please log in first.');
		await startMenu();
		return;
	}
	
	const prompt = new Enquirer.Form({
		name: 'batchForm',
		message: 'Batch Download from JSON',
		choices: [
			{
				name: 'jsonPath',
				type: 'input',
				message: 'Path to JSON file with books list',
				initial: './books.json',
				validate: (value) => {
					if (!value.trim()) {
						return 'Please enter a file path';
					}
					if (!fs.existsSync(value.trim())) {
						return 'File does not exist';
					}
					return true;
				}
			}
		]
	});
	
	try {
		const response = await prompt.run();
		const jsonPath = response.jsonPath.trim();
		
		// Confirm before starting
		const confirmPrompt = new Enquirer.Toggle({
			message: `Start batch download from ${jsonPath}?`,
			enabled: 'Yes',
			disabled: 'No'
		});
		
		const confirmed = await confirmPrompt.run();
		
		if (confirmed) {
			await batchDownload.batchDownload(jsonPath);
		}
		
		await startMenu();
		
	} catch (error) {
		// Handle cancellation (empty error or 'cancelled' message)
		if (error && error.message && error.message !== 'cancelled') {
			await errorPrompt(`Error: ${error.message}`);
		}
		await startMenu();
	}
}

/**
 * @param searchTerm {string}
 */
async function directSearch(searchTerm){
	const answer = {};
	answer.message = searchTerm;
	answer.yearFrom = "0";
	answer.yearTo = String(new Date().getFullYear());
	answer.languages = configs.getDefaultLanguages().split(",");
	answer.extensions = configs.getDefaultExtensions().split(",");
	answer.limit = 50
	answer.order = "popular";
	
	console.log(`Searching Z-Library for: "${searchTerm}"`);
	console.log(`Languages: ${answer.languages.join(', ')} | Extensions: ${answer.extensions.join(', ')}`);

	const response = await api.search(answer);
	try{
		await bookListMenu(response, answer);
	}
	catch(err){
		if (err && err.message !== 'search cancelled') console.error(err);
		// If search is cancelled, we just exit the program since we bypassed the menu
	}
}

export default {errorPrompt,startMenu,settingsMenu, loginOptions, loginMenu, tokenLoginMenu, openDownloads, searchMenu, bookListMenu, viewBook, downloadMenu, batchDownloadMenu, directSearch};
