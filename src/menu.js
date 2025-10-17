import Enquirer from 'enquirer';
import api from './api.js';
import batchDownload from './batch-download.js';
import configs from './config.js';
import fs from 'fs';
import open from 'open';
import vimShortcuts from './vim-shortcuts.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startMenu(){
	console.clear();
	let accountPrompt = configs.isLoggedIn()?"Sign out":"Log in";
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
	const prompt = new Enquirer.Form({
		name:"settingPrompt",
		message:"User settings",
		choices:[
			{name:"downloadPath",message:"Book download path", initial:configs.getDownloadPath()},
			{name:"domain", message:"Public domain (eg. singlelogin.me)", initial:configs.getMirror(true)},
			{name:"personalDomain", message:"Personal domain", initial:configs.getMirror()}
		]
	});
	const response = await prompt.run();
	configs.saveSettings(response);
	await startMenu();
}
async function loginOptions(){
	console.clear();
	const prompt = new Enquirer.Select({
		name: "loginMenu",
		message: "What would you like to do?",
		choices: ["Log in", "Log in with user key", "Update personal domain", "Back"],
		actions:vimShortcuts	
	});
	let result = await prompt.run();
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
	startMenu();
}
async function tokenLoginMenu(){
	console.clear();
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
	const prompt = new Enquirer.Form({
		name:"searchForm",
		message:"Search Z-Library",
		choices: [
			{name:"message", message:"Search term", initial:""},
			{name:"yearFrom", message:"Start year", initial:"0"},
			{name:"yearTo", message:"End year", initial:String(new Date().getFullYear())},
			{name:"languages", message:"Languages", initial:"english,german,french"},
			{name:"extensions", message:"Searched extensions", initial:"txt,pdf,fb2,epub,lit,mobi,rtf,djv,djvu,azw,azw3"}

		]
	});
	let answer = await prompt.run();
	answer.languages = answer.languages.split(",");
	answer.extensions = answer.extensions.split(",");
	answer.limit = 50
	answer.order = "popular";
	const response = await api.search(answer);
	try{
		await bookListMenu(response);
	}
	catch(err){
		await searchMenu();
	}
}
async function bookListMenu(bookList){
	const promptChoices = bookList.books.map((book,index)=>{
		return {
			name:String(index),
			value:String(index),
			message: String(index + 1) + "| " +book.title + " by " + book.author
		}	
	});
	const postToView = await Enquirer.prompt([{
		type:"select",
		name:"book",
		message:"Which book do you want to view?",
		initial:"0",
		choices:promptChoices,
		actions:vimShortcuts
	}]);
	try{
		await viewBook(bookList.books[postToView.book]);
	}
	catch(err){
		await bookListMenu(bookList);
	}
}
async function viewBook(bookData){
	console.clear();
	let displayData = "";
	for(let data in bookData){
		displayData += `${data}: ${bookData[data]}\n`
	}
	console.log(displayData);
	const prompt = new Enquirer.Toggle({
		message:"Download book? ",
		name:"downloadBook",
		enabled:"Download",
		disabled:"Cancel"
	});	
	let answer = await prompt.run();
	if(!answer){
		throw new Error("download cancelled");
	}
	await downloadMenu(bookData.id, bookData.hash);
}
async function downloadMenu(id, hash){
	console.clear();
	console.log("Fetching download link..");
	const downloadData = await api.getDownloadLink(id, hash);
	if(!downloadData.success == 1){
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
	fs.writeFileSync(downloadData.filename, fileData);
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
		if (error.message !== 'cancelled') {
			await errorPrompt(`Error: ${error.message}`);
		}
		await startMenu();
	}
}

export default {errorPrompt,startMenu,settingsMenu, loginOptions, loginMenu, tokenLoginMenu, openDownloads, searchMenu, bookListMenu, viewBook, downloadMenu, batchDownloadMenu};
