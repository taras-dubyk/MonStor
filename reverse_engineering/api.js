'use strict';
const async = require('async');
const fetch = require('node-fetch');

module.exports = {
	testConnection: function(connectionInfo, logger, cb){
		this.getDbCollectionsNames(connectionInfo, logger, (err, res) => {
			return cb(Boolean(err));
		});
	},

	getDbCollectionsNames: function(connectionInfo, logger, cb) {
		logger.log('info', connectionInfo, 'Reverse-Engineering connection settings', connectionInfo.hiddenKeys);
		getKeyspacesList(connectionInfo, (err, res) => {
			if(err){
				logger.log('error', err);
				cb(err);
			} else {
				let keyspacesNames = res.data.map(ks => ks.name);
				logger.log('info', { KeyspacesList: res.data }, 'Keyspaces list for current database', connectionInfo.hiddenKeys);
				handleKeyspace(connectionInfo, keyspacesNames, logger, cb);
			}
		});
	},

	getDbCollectionsData: function(connectionInfo, logger, cb){
		let includeEmptyCollection = connectionInfo.includeEmptyCollection;
		let { recordSamplingSettings, fieldInference } = connectionInfo;
		let keyspacesList = connectionInfo.collectionData.dataBaseNames;
		
		logger.log('info', connectionInfo, 'Reverse-Engineering connection settings', connectionInfo.hiddenKeys);
		logger.log('info', getSamplingInfo(recordSamplingSettings, fieldInference), 'Reverse-Engineering sampling params', connectionInfo.hiddenKeys);
		logger.log('info', { KeyspacesList: keyspacesList }, 'Selected keyspaces list', connectionInfo.hiddenKeys);

		async.map(keyspacesList, (keyspaceName, keyspaceItemCallback) => {
			readKeyspaceByName(keyspaceName, connectionInfo, (err, keySpace) => {
				if(err){
					console.log(err);
					logger.log('error', err);
					return keyspaceItemCallback(err)
				} else {
					let collectionList = connectionInfo.collectionData.collections[keyspaceName];
					async.map(collectionList, (collectionName, collectionItemCallback) => {
						let documentsPackage = {
							dbName: keyspaceName,
							collectionName,
							documents: [],
							indexes: [],
							bucketIndexes: [],
							views: [],
							validation: false,
							bucketInfo: {}
						};
						return collectionItemCallback(null, documentsPackage);
					}, (err, items) => {
						if(err){
							console.log(err);
							logger.log('error', err);
						}
						return keyspaceItemCallback(err, items);
					});
				}
			});
		}, (err, items) => {
			if(err){
				console.log(err);
				logger.log('error', err);
			}
			return cb(err, items);
		});
	}
}

function getRequestOptions(connectionInfo){
	let headers = {
		'Cache-Control': 'no-cache',
		'Accept': 'application/json'
	};

	if(connectionInfo.useAuth && connectionInfo.userName && connectionInfo.password){
		let credentials = `${connectionInfo.userName}:${connectionInfo.password}`;
		let encodedCredentials = new Buffer(credentials).toString('base64');
		headers.Authorization = `Basic ${encodedCredentials}`;
	}

	return {
		'method': 'GET',
		'headers': headers
	};
}

function fetchRequest(query, connectionInfo){
	let options = getRequestOptions(connectionInfo);
	let response;

	return fetch(query, options)
		.then(res => {
			response = res;
			return res.text();
		})
		.then(body => {
			body = JSON.parse(body);

			if(!response.ok){
				throw {
					message: response.statusText, code: response.status, description: body
				};
			}
			return body;
		});
}

function handleKeyspace(connectionInfo, keyspacesNames, logger, cb){
	async.map(keyspacesNames, (keyspaceName, keyspaceItemCallback) => {
		readKeyspaceByName(keyspaceName, connectionInfo, (err, keySpace) => {
			if(err){
				console.log(err);
				logger.log('error', err);
				keyspaceItemCallback(err);
			} else {
				let size = /*getSampleDocSize(amount, connectionInfo.recordSamplingSettings) ||*/ 1000;

				getCollectionsList(keyspaceName, size, connectionInfo, (err, collectionList) => {
					if(err){
						console.log(err);
						return keyspaceItemCallback(err);
					} else {
						logger.log('info', { CollectionList: collectionList }, 'Collection list for current database', connectionInfo.hiddenKeys);
						let collectionNames = collectionList.data.map(coll => coll.name);
						let dataItem = prepareConnectionDataItem(keyspaceName, collectionNames);
						return keyspaceItemCallback(err, dataItem);
					}
				});
			}
		});
	}, (err, items) => {
		if(err){
			console.log(err);
			logger.log('error', err);
		}
		return cb(err, items);
	});
}

function getKeyspacesList(connectionInfo, cb){
	let query = `${connectionInfo.host}:${connectionInfo.port}/api/v1/keyspaces`;
	//let query = 'https://api.myjson.com/bins/mr4hb';
	return fetchRequest(query, connectionInfo).then(res => {
		return cb(null, res);
	})
	.catch(err => {
		console.log(err);
		return cb(err);
	});
}

function readKeyspaceByName(keyspaceName, connectionInfo, cb){
	let query = `${connectionInfo.host}:${connectionInfo.port}/api/v1/keyspaces/${keyspaceName}`;
	//let query = 'https://api.myjson.com/bins/124blr';
	return fetchRequest(query, connectionInfo).then(res => {
		res.data.name = keyspaceName;
		return cb(null, res);
	})
	.catch(err => {
		console.log(err);
		return cb(err);
	});
}

function getCollectionsList(keyspaceName, size, connectionInfo, cb){
	let query = `${connectionInfo.host}:${connectionInfo.port}/api/v1/keyspaces/${keyspaceName}/collections`;
	//let query = 'https://api.myjson.com/bins/uqjpb';
	return fetchRequest(query, connectionInfo).then(res => {
		return cb(null, res);
	})
	.catch(err => {
		console.log(err);
		return cb(err);
	});
}

function prepareConnectionDataItem(keyspaceName, collectionNames){
	let connectionDataItem = {
		dbName: keyspaceName,
		dbCollections: collectionNames
	};

	return connectionDataItem;
}

function getSamplingInfo(recordSamplingSettings, fieldInference){
	let samplingInfo = {};
	let value = recordSamplingSettings[recordSamplingSettings.active].value;
	let unit = (recordSamplingSettings.active === 'relative') ? '%' : ' records max';
	samplingInfo.recordSampling = `${recordSamplingSettings.active} ${value}${unit}`
	samplingInfo.fieldInference = (fieldInference.active === 'field') ? 'keep field order' : 'alphabetical order';
	return samplingInfo;
}