export const UPDATE_CARDS = 'UPDATE_CARDS';
export const UPDATE_SECTIONS = 'UPDATE_SECTIONS';
export const UPDATE_TAGS = 'UPDATE_TAGS';
export const UPDATE_AUTHORS= 'UPDATE_AUTHORS';
export const UPDATE_TWEETS = 'UPDATE_TWEETS';
export const REMOVE_CARDS = 'REMOVE_CARDS';
export const TWEETS_LOADING = 'TWEETS_LOADING';
export const MODIFY_CARD = 'MODIFY_CARD';
export const MODIFY_CARD_SUCCESS = 'MODIFY_CARD_SUCCESS';
export const MODIFY_CARD_FAILURE = 'MODIFY_CARD_FAILURE';
export const REORDER_STATUS = 'REORDER_STATUS';
export const SET_PENDING_SLUG = 'SET_PENDING_SLUG';
export const EXPECT_NEW_CARD = 'EXPECT_NEW_CARD';
export const EXPECTED_NEW_CARD_FAILED = 'EXPECTED_NEW_CARD_FAILED';
export const NAVIGATED_TO_NEW_CARD = 'NAVIGATED_TO_NEW_CARD';
export const EXPECT_CARD_DELETIONS = 'EXPECT_CARD_DELETIONS';
export const COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED = 'COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED';
export const EXPECT_UNPUBLISHED_CARDS = 'EXPECT_UNPUBLISHED_CARDS';

import {
	slugLegal,
	CARDS_COLLECTION,
	CARD_UPDATES_COLLECTION,
	SECTION_UPDATES_COLLECTION,
	SECTIONS_COLLECTION,
	TAGS_COLLECTION,
	TAG_UPDATES_COLLECTION,
	TWEETS_COLLECTION,
} from './database.js';

import {
	db,
	serverTimestampSentinel,
	arrayUnionSentinel,
	arrayRemoveSentinel
} from '../firebase.js';

import {
	navigateToCardInCurrentCollection,
	navigateToNextCard
} from './app.js';

import {
	closeMultiEditDialog
} from './multiedit.js';

import {
	editingFinish,
	slugAdded,
	tagAdded
} from './editor.js';

import {
	newID,
	idWasVended,
	normalizeSlug,
	createSlugFromArbitraryString,
} from '../util.js';

import {
	ensureAuthor
} from './comments.js';

import {
	refreshCardSelector,
	updateCollectionSnapshot,
} from './collection.js';

import {
	selectActiveSectionId,
	selectUser,
	selectUserIsAdmin,
	selectFilters,
	selectCards,
	selectDataIsFullyLoaded,
	selectCardIDsUserMayEdit,
	selectLastSectionID,
	getUserMayEditSection,
	selectUserMayCreateCard,
	selectPendingNewCardIDToNavigateTo,
	selectIsEditing,
	selectActiveCardId,
	getReasonUserMayNotDeleteCard,
	selectExpectedDeletions,
	selectCardModificationPending,
	getCardById,
	selectMultiEditDialogOpen,
	selectSortOrderForGlobalAppend,
	getSortOrderImmediatelyAdjacentToCard,
	selectUserMayReorderActiveCollection,
	selectActiveCollectionDescription
} from '../selectors.js';

import {
	INVERSE_FILTER_NAMES,
	SET_NAMES,
	SORT_URL_KEYWORD,
	CONFIGURABLE_FILTER_URL_PARTS,
} from '../filters.js';

import {
	PERMISSION_EDIT_CARD
} from '../permissions.js';

import {
	CARD_TYPE_CONFIGURATION,
	TEXT_FIELD_BODY,
	DEFAULT_CARD_TYPE,
	CARD_TYPE_SECTION_HEAD,
	REFERENCES_CARD_PROPERTY,
	REFERENCES_INFO_CARD_PROPERTY,
	REFERENCES_INFO_INBOUND_CARD_PROPERTY, 
	REFERENCES_INBOUND_CARD_PROPERTY,
	REFERENCE_TYPE_FORK_OF,
	REFERENCE_TYPE_MINED_FROM,
	KEY_CARD_ID_PLACEHOLDER,
	TEXT_FIELD_TITLE,
	editableFieldsForCardType,
	sortOrderIsDangerous
} from '../card_fields.js';

import {
	cardDiffHasChanges,
	validateCardDiff,
	applyCardDiff,
} from '../card_diff.js';

import {
	CARD_TYPE_EDITING_FINISHERS
} from '../card_finishers.js';

import {
	references,
} from '../references.js';

import {
	store
} from '../store.js';

import {
	MultiBatch
} from '../multi_batch.js';


//map of cardID => promise that's waiting
let waitingForCards = {};

const waitingForCardToExistStoreUpdated = () => {
	let itemDeleted = false;
	for (const cardID of Object.keys(waitingForCards)) {
		const card = getCardById(store.getState(), cardID);
		if (!card) continue;
		for (let promise of waitingForCards[cardID]) {
			promise.resolve(card);
		}
		delete waitingForCards[cardID];
		itemDeleted = true;
	}
	if (itemDeleted && Object.keys(waitingForCards).length == 0) {
		unsubscribeFromStore();
		unsubscribeFromStore = null;
	}
};

let unsubscribeFromStore = null;

//returns a promise that will be resolved when a card with that ID exists, returning the card.
export const waitForCardToExist = (cardID) => {
	const card = getCardById(store.getState(), cardID);
	if (card) return Promise.resolve(card);
	if (!waitingForCards[cardID]) waitingForCards[cardID] = [];
	if (!unsubscribeFromStore) unsubscribeFromStore = store.subcribe(waitingForCardToExistStoreUpdated);
	const promise = new Promise();
	waitingForCards[cardID].push(promise);
	return promise;
};

//When a new tag is created, it is randomly assigned one of these values.
const TAG_COLORS = [
	//Indianred
	'#CD5C5C',
	//darkkhahki
	'#BDB76B',
	//limegreen
	'#32CD32',
	//darkcyan
	'#008B8B',
	//navy
	'#000080',
	//sandybrown
	'#F4A460',
	//gold
	'#FFD700',
	//darkmagenta
	'#8B008B',
	//royalblue
	'#4169E1',
];

export const modifyCard = (card, update, substantive) => {
	return modifyCards([card], update, substantive, true);
};

export const modifyCards = (cards, update, substantive, failOnError) => async (dispatch, getState) => {
	const state = getState();

	if (selectCardModificationPending(state)) {
		console.log('Can\'t modify card; another card is being modified.');
		return;
	}

	dispatch(modifyCardAction());

	const batch = new MultiBatch(db);
	let modifiedCount = 0;
	let errorCount = 0;

	for (const card of cards) {

		if (!card || !card.id) {
			console.log('No id on card');
			if (failOnError) return;
			continue;
		}

		try {
			if (modifyCardWithBatch(state, card, update, substantive, batch)) modifiedCount++;
		} catch (err) {
			console.warn('Couldn\'t modify card: ' + err);
			errorCount++;
			if (failOnError) {
				dispatch(modifyCardFailure(err));
				return;
			}
		}
	}

	try {
		await batch.commit();
	} catch(err) {
		dispatch(modifyCardFailure('Couldn\'t save card: ' + err));
		return;
	}

	if (modifiedCount > 1 || errorCount > 0) alert('' + modifiedCount + ' cards modified.' + (errorCount > 0 ? '' + errorCount + ' cards errored. See the console for why.' : ''));

	dispatch(modifyCardSuccess());
};

//returns true if a modificatioon was made to the card, or false if it was a no
//op. When an error is thrown, that's an implied 'false'
export const modifyCardWithBatch = (state, card, update, substantive, batch) => {

	//If there aren't any updates to a card, that's OK. This might happen in a
	//multiModify where some cards already have the items, for example.
	if (!cardDiffHasChanges(update)) return false;

	const user = selectUser(state);

	if (!user) {
		throw new Error('No user');
	}

	if (!selectCardIDsUserMayEdit(state)[card.id]) {
		throw new Error('User isn\'t allowed to edit the given card');
	}

	let updateObject = {
		...update,
		batch: batch.batchID || '',
		substantive: substantive,
		timestamp: serverTimestampSentinel()
	};

	//validateDiff might throw, but that's OK, because we also throw
	let sectionUpdated = validateCardDiff(state, card, update);

	let cardUpdateObject = applyCardDiff(card, update);
	cardUpdateObject.updated = serverTimestampSentinel();
	if (substantive) cardUpdateObject.updated_substantive = serverTimestampSentinel();

	let cardRef = db.collection(CARDS_COLLECTION).doc(card.id);

	let updateRef = cardRef.collection(CARD_UPDATES_COLLECTION).doc('' + Date.now());

	batch.set(updateRef, updateObject);
	batch.update(cardRef, cardUpdateObject);

	ensureAuthor(batch, user);

	if (sectionUpdated) {
		//Need to update the section objects too.
		let newSection = cardUpdateObject.section;
		if (newSection) {
			let newSectionRef = db.collection(SECTIONS_COLLECTION).doc(newSection);
			let newSectionUpdateRef = newSectionRef.collection(SECTION_UPDATES_COLLECTION).doc('' + Date.now());
			let newSectionObject = {
				cards: arrayUnionSentinel(card.id),
				updated: serverTimestampSentinel()
			};
			let newSectionUpdateObject = {
				timestamp: serverTimestampSentinel(),
				add_card: card.id
			};
			batch.update(newSectionRef, newSectionObject);
			batch.set(newSectionUpdateRef, newSectionUpdateObject);
		}
		let oldSection = card.section;
		if (oldSection) {
			let oldSectionRef = db.collection(SECTIONS_COLLECTION).doc(oldSection);
			let oldSectionUpdateRef = oldSectionRef.collection(SECTION_UPDATES_COLLECTION).doc('' + Date.now());
			let oldSectionObject = {
				cards: arrayRemoveSentinel(card.id),
				updated: serverTimestampSentinel()
			};
			let oldSectionUpdateObject = {
				timestamp: serverTimestampSentinel(),
				remove_card: card.id
			};
			batch.update(oldSectionRef, oldSectionObject);
			batch.set(oldSectionUpdateRef, oldSectionUpdateObject);
		}
	}

	if (update.addTags && update.addTags.length) {
		//Note: similar logic is replicated in createForkedCard
		for (let tagName of update.addTags) {
			let tagRef = db.collection(TAGS_COLLECTION).doc(tagName);
			let tagUpdateRef = tagRef.collection(TAG_UPDATES_COLLECTION).doc('' + Date.now());
			let newTagObject = {
				cards: arrayUnionSentinel(card.id),
				updated: serverTimestampSentinel()
			};
			let newTagUpdateObject = {
				timestamp: serverTimestampSentinel(),
				add_card: card.id
			};
			batch.update(tagRef, newTagObject);
			batch.set(tagUpdateRef, newTagUpdateObject);
		}
	}

	if (update.removeTags && update.removeTags.length) {
		for (let tagName of update.removeTags) {
			let tagRef = db.collection(TAGS_COLLECTION).doc(tagName);
			let tagUpdateRef = tagRef.collection(TAG_UPDATES_COLLECTION).doc('' + Date.now());
			let newTagObject = {
				cards: arrayRemoveSentinel(card.id),
				updated: serverTimestampSentinel()
			};
			let newTagUpdateObject = {
				timestamp: serverTimestampSentinel(),
				remove_card: card.id
			};
			batch.update(tagRef, newTagObject);
			batch.set(tagUpdateRef, newTagUpdateObject);
		}
	}

	return true;

};

//beforeID is the ID of hte card we should place ourselves immediately before.
export const reorderCard = (card, otherID, isAfter) => async (dispatch, getState) => {

	const state = getState();

	if (!card || !card.id) {
		console.log('That card isn\'t valid');
		return;
	}

	if (card.id == otherID) {
		console.log('Dropping into the same position it is now, which is a no op');
		return;
	}

	if (!selectUserMayReorderActiveCollection(state)) {
		console.log('Reordering the current collection is not allowed');
		return;
	}

	const collectionDescription = selectActiveCollectionDescription(state);

	if (collectionDescription.sortReversed) isAfter = !isAfter;

	const newSortOrder = getSortOrderImmediatelyAdjacentToCard(state, otherID, !isAfter);

	if (sortOrderIsDangerous(newSortOrder)) {
		console.warn('Dangerous sort order proposed: ', newSortOrder, ' See issue #199');
		return;
	}

	dispatch(reorderStatus(true));

	const batch = new MultiBatch(db);
	const update = {
		sort_order: newSortOrder,
	};
	modifyCardWithBatch(state, card, update, false, batch);

	try {
		await batch.commit();
	} catch(err) {
		console.warn(err);
	}
	dispatch(reorderStatus(false));

	//We don't need to tell the store anything, because firestore will tell it
	//automatically.

};

const setPendingSlug = (slug) => {
	return {
		type:SET_PENDING_SLUG,
		slug
	};
};

const addLegalSlugToCard = (cardID, legalSlug, setName) => {
	//legalSlug must already be verified to be legal.
	let batch = db.batch();
	const cardRef = db.collection(CARDS_COLLECTION).doc(cardID);
	let update = {
		slugs: arrayUnionSentinel(legalSlug),
		updated: serverTimestampSentinel(),
	};
	if (setName) update.name = legalSlug;
	batch.update(cardRef, update);
	return batch.commit();
};

export const addSlug = (cardId, newSlug) => async (dispatch, getState) => {
 
	newSlug = normalizeSlug(newSlug);

	if (!newSlug) {
		console.log('Must provide a legal slug');
		return;
	}

	let state = getState();
	const isEditingCard = state.editor.card && state.editor.card.id == cardId;

	//slugLegal is a http callable, and it might take multiple seconds if the
	//cloud function is cold.
	dispatch(setPendingSlug(newSlug));

	let result;
	try {
		result = await slugLegal(newSlug);
	} catch(err) {
		dispatch(setPendingSlug(''));
		console.warn(err);
		return;
	}

	if (!result.legal) {
		alert('Couldn\'t add slug: ' + result.reason);
		dispatch(setPendingSlug(''));
		return;
	}

	await addLegalSlugToCard(cardId, newSlug, false);

	dispatch(setPendingSlug(''));

	if (isEditingCard) {
		//We're editing this card, update it in the state.
		dispatch(slugAdded(newSlug));
	}

};

const reservedCollectionName = (state, name) => {

	if (!selectDataIsFullyLoaded(state)) {
		console.warn('Sections not loaded');
		return true;
	}

	if (name == SORT_URL_KEYWORD) return true;
	if (name == KEY_CARD_ID_PLACEHOLDER) return true;

	//Filters already contains section names if data is fully loaded.
	const filters = selectFilters(state) || {};

	let keys = [...Object.keys(filters), ...Object.keys(INVERSE_FILTER_NAMES), ...SET_NAMES, ...Object.keys(CONFIGURABLE_FILTER_URL_PARTS)];

	for (let key of keys) {
		if (name == key) return true;
	}
	return false;
};

export const createTag = (name, displayName) => async (dispatch, getState) => {

	if (!name) {
		console.warn('No short name provided');
		return;
	}

	name = normalizeSlug(name);

	const state = getState();

	if (reservedCollectionName(state, name)) {
		console.warn('That name is reserved');
		return;
	}

	if (!name) {
		console.warn('Tag name invalid');
		return;
	}

	if (!displayName) {
		console.warn('No short name provided');
		return;
	}

	let user = selectUser(state);

	if (!user) {
		console.warn('No user logged in');
		return;
	}

	if (!selectUserIsAdmin(state)) {
		console.log('User isn\'t admin!');
		return;
	}

	let tagRef = db.collection(TAGS_COLLECTION).doc(name);

	let tag = await tagRef.get();

	if (tag.exists) {
		console.warn('A tag with that name already exists');
		return;
	}

	let startCardId = 'tag-' + name;
	let startCardRef = db.collection(CARDS_COLLECTION).doc(startCardId);

	let card = await startCardRef.get();

	if (card.exists) {
		console.warn('A card with that id already exists');
		return;
	}

	//Randomly pick a tag color to start with. If an admin wants to edit it they
	//can just edit it by hand in the DB.
	let color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];

	let batch = db.batch();

	batch.set(tagRef, {
		cards: [],
		start_cards: [startCardId],
		title:displayName,
		updated: serverTimestampSentinel(),
		color: color,
	});

	let cardObject = defaultCardObject(startCardId, user, '', CARD_TYPE_SECTION_HEAD, selectSortOrderForGlobalAppend(state));
	cardObject.title = displayName;
	cardObject.subtitle = displayName + ' is a topical tag';
	cardObject.published = true;

	batch.set(startCardRef, cardObject);

	batch.commit().then(dispatch(tagAdded(name)));

};

//This omits fields that are already covered in defaultCardObject's arguments
const CARD_FIELDS_TO_COPY_ON_FORK = {
	permissions: true,
	title: true,
	body: true,
	[REFERENCES_INFO_CARD_PROPERTY]: true,
	[REFERENCES_CARD_PROPERTY]: true,
	font_size_boost: true,
	notes: true,
	todo: true,
	tags: true,
};

//exported entireoly for initialSetUp in maintence.js
export const defaultCardObject = (id, user, section, cardType, sortOrder) => {
	return {
		created: serverTimestampSentinel(),
		updated: serverTimestampSentinel(),
		author: user.uid,
		permissions: {
			[PERMISSION_EDIT_CARD]: [],
		},
		collaborators: [],
		updated_substantive: serverTimestampSentinel(),
		updated_message: serverTimestampSentinel(),
		//star_count is sum of star_count_manual, tweet_favorite_count, tweet_retweet_count.
		star_count: 0,
		//star_count_manual is the count of stars in the stars collection (as
		//opposed to faux stars that are tweet enagement actions)
		star_count_manual: 0,
		//The sum of favorite counts for all tweets for this card
		tweet_favorite_count: 0,
		//The sum of retweet counts for all tweets for this card
		tweet_retweet_count: 0,
		thread_count: 0,
		thread_resolved_count: 0,
		//A number that is compared to other cards to give the default sort
		//order. Higher numbers will show up first in the default sort order.
		//Before saving the card for the first time, you should set this to a
		//reasonable value, typically DEFAULT_SORT_ORDER_INCREMENT smaller than
		//every card already known to exist.
		sort_order: sortOrder,
		title: '',
		section: section,
		body: '',
		//See the documentation for these two string contants in card_fields.js
		//for information on the shape of these fields.
		[REFERENCES_INFO_CARD_PROPERTY]: {},
		[REFERENCES_INFO_INBOUND_CARD_PROPERTY]: {},
		//Sentinel version are like the normal properties, but where it's a map
		//of cardID to true if there's ANY kind of refernce. Whenever a card is
		//modified, these sentinels are automatically mirrored basd on the value
		//of references. They're popped out primarily so that you can do
		//firestore qureies on them to find cards that link to another.
		[REFERENCES_CARD_PROPERTY]: {},
		[REFERENCES_INBOUND_CARD_PROPERTY]: {},
		//Keys in this object denote fields that should have their emsize
		//boosted, with a missing key equal to a boost of 0.0. The font size is
		//1.0 + the boost, in ems.
		font_size_boost: {},
		card_type: cardType,
		notes: '',
		todo: '',
		slugs: [],
		name: id,
		tags: [],
		published: false,
		//images is an imagesBlock. See src/images.js for a definition.
		images: [],
		//auto_todo_overrides is a map of key -> true or false, for each kind of
		//TODO (as enumerated in TODO_OVERRIDE_LEGAL_KEYS). A value of true
		//means that the TODO is overrided to the "done" state for that TODO, no
		//matter how else the card is configured. A false means it it is
		//overridden to the "not done" state no mater how the rest of the card
		//is configured. And a missing key means "based on what the TODO
		//function said for that key based on being passed the card"
		auto_todo_overrides: {},
		//Defaul to epoch 1970 for things not yet tweeted
		last_tweeted: new Date(0),
		tweet_count: 0
		//Note: there are three fields that are often set on cards but not persisted to database:
		//normalized - this is set by cardWithNormalizedTextProperties and is where all of the nlp-based machinery is based on.
		//fallbackText - this is stashed there so that the cardWithNormalizedTextProperties machinery can fetch it if it wants.
		//importantNgrams - agains stashed here by cardWithNormalizedTextProperties so wordCountForSemantics can fetch it.
	};
};

//createCard creates an inserts a new card. see also createWorkingNotesCard
//which is similar but simpler.
//Valid arguments of opts:
// cardType: type of card
// section: sectionID to add to
// id: ID to use
// noNavigate: if true, will not navigate to the card when created
// title: title of card
export const createCard = (opts) => async (dispatch, getState) => {

	//NOTE: if you modify this card you may also want to modify createForkedCard

	//newCard creates and inserts a new card in the givne section with the given id.

	const state = getState();

	let user = selectUser(state);

	if (!user) {
		console.log('No user');
		return;
	}

	if (!selectUserMayCreateCard(state)) {
		console.log('User isn\'t allowed to create card');
		return;
	}

	let cardType = opts.cardType || DEFAULT_CARD_TYPE;

	let CARD_TYPE_CONFIG = CARD_TYPE_CONFIGURATION[cardType] || null;
	if (!CARD_TYPE_CONFIG) {
		console.log('Invalid cardType: ' + cardType);
		return;
	}

	//if section is not provided, use the last section... unless it's a card
	//type that is orphaned by default, in which case we should not put it in a
	//section at all.
	let section = opts.section || '';
	
	if (!section && !CARD_TYPE_CONFIG.orphanedByDefault) {
		section = selectLastSectionID(state);
	}

	if (!section && !CARD_TYPE_CONFIG.orphanedByDefault) {
		console.log('No section identified for a card type that is not orphaned by default');
		return;
	}

	let id = opts.id;
	let idFromOpts = opts.id !== undefined;

	if (id) {
		id = normalizeSlug(id);
	} else {
		id = newID();
	}

	let noNavigate = opts.noNavigate || false;

	let title = opts.title || '';

	if (CARD_TYPE_CONFIG.publishedByDefault && editableFieldsForCardType(cardType)[TEXT_FIELD_TITLE] && !title) {
		const titleFromPrompt = prompt('What should the card\'s title be?');
		if (!titleFromPrompt) {
			console.log('No title provided');
			return;
		}
		title = titleFromPrompt;
	}

	if (section && !getUserMayEditSection(state, section)) {
		console.log('User doesn\'t have edit permission for section the card will be added to.');
		return;
	}

	let sortOrder = selectSortOrderForGlobalAppend(state);
	if (section && selectActiveSectionId(state) == section) {
		sortOrder = getSortOrderImmediatelyAdjacentToCard(state, selectActiveCardId(state), false);
	}

	if (sortOrderIsDangerous(sortOrder)) {
		console.warn('Dangerous sort order proposed: ', sortOrder, sortOrder / Number.MAX_VALUE, ' See issue #199');
		return;
	}

	let obj = defaultCardObject(id, user, section, cardType, sortOrder);
	obj.title = title;
	if (CARD_TYPE_CONFIG.publishedByDefault) obj.published = true;
	if (CARD_TYPE_CONFIG.defaultBody) obj[TEXT_FIELD_BODY] = CARD_TYPE_CONFIG.defaultBody;

	const cardFinisher = CARD_TYPE_EDITING_FINISHERS[cardType];

	if (cardFinisher) {
		try {
			cardFinisher(obj, state);
		} catch(err) {
			alert(err);
			console.warn('Card finisher threw an error');
			return;
		}
	}

	let autoSlug = '';
	let fallbackAutoSlug = '';
	if (CARD_TYPE_CONFIG.autoSlug) {
		autoSlug = createSlugFromArbitraryString(title);
		fallbackAutoSlug = normalizeSlug(cardType + '-' + autoSlug);
	}

	if (CARD_TYPE_CONFIG.publishedByDefault && CARD_TYPE_CONFIG.autoSlug) {
		if (!confirm('You\'re creating a card that will be published by default and have its slug set automatically. Is it spelled correctly?\n\nTitle: ' + title + '\nSlug:' + autoSlug + '\nAlternate Slug: ' + fallbackAutoSlug + '\n\nDo you want to proceed?')) {
			console.log('Aborted by user');
			return;
		}
	}

	let cardDocRef = db.collection(CARDS_COLLECTION).doc(id);

	//Tell card-view to expect a new card to be loaded, and when data is
	//fully loaded again, it will then trigger the navigation.
	dispatch({
		type: EXPECT_NEW_CARD,
		ID: id,
		cardType: cardType,
		navigate: !noNavigate,
		noSectionChange: !section,
		published: obj.published,
	});

	if (idFromOpts && !idWasVended(id)) {

		//Checking id is legal is a very expensive operation. If we generated
		//our own id via newID we can just assume it's safe and doesn't conflict
		//with existing ones due to sufficient entropy.

		//Check to make sure the ID is legal. Note that the id and slugs are in the
		//same ID space, so we can reuse slugLegal. Note that slugLegal could take
		//up to 10 seconds to complete if the cloud function is not pre-warmed.
		const result = await slugLegal(id);
		if (!result.legal) {
			console.log('ID is already taken: ' + result.reason);
			if (!noNavigate) {
				//Tell it to not expect the card to be inserted anymore
				dispatch({
					type:EXPECTED_NEW_CARD_FAILED,
				});
			}
			return;
		}
	}

	let autoSlugLegalPromise = null;
	let fallbackAutoSlugLegalPromise = null;
	if (CARD_TYPE_CONFIG.autoSlug) {
		//Kick this off in parallel. We'll await it later.
		autoSlugLegalPromise = slugLegal(autoSlug);
		fallbackAutoSlugLegalPromise = slugLegal(fallbackAutoSlug);
	}

	const batch = db.batch();

	ensureAuthor(batch, user);
	batch.set(cardDocRef, obj);

	if (section) {
		let sectionRef = db.collection(SECTIONS_COLLECTION).doc(obj.section);
		let sectionUpdateRef = sectionRef.collection(SECTION_UPDATES_COLLECTION).doc('' + Date.now());
		batch.update(sectionRef, {
			cards: arrayUnionSentinel(id),
			updated: serverTimestampSentinel(),
		});
		batch.set(sectionUpdateRef, {
			timestamp: serverTimestampSentinel(), 
			add_card: id
		});
	}

	try {
		await batch.commit();
	} catch (err) {
		console.warn(err);
		dispatch({type: EXPECTED_NEW_CARD_FAILED});
	}

	//updateSections will be called and update the current view. card-view's
	//updated will call navigateToNewCard once the data is fully loaded again
	//(if EXPECT_NEW_CARD was dispatched above). If noSectionChange is true
	//above, it will only wait for the card, not the section, to load.

	if (!autoSlug) return;

	await waitForCardToExist(id);
	const autoSlugLegalResult = await autoSlugLegalPromise;
	const fallbackAutoSlugLegalResult = await fallbackAutoSlugLegalPromise;

	if (!autoSlugLegalResult.legal && !fallbackAutoSlugLegalResult.legal) {
		console.warn('The autoSlug, ' + autoSlug + ' (and its fallback ' + fallbackAutoSlug + ') was not legal, so it will not be proposed. Reason: ' + autoSlugLegalResult.reason + ' and ' + fallbackAutoSlugLegalResult.reason);
		return;
	}

	const slugToUse = autoSlugLegalResult.legal ? autoSlug : fallbackAutoSlug;

	try {
		await addLegalSlugToCard(id, slugToUse, true);
	} catch(err) {
		console.warn('Couldn\'t add slug to card: ' + err);
	}

};

export const createForkedCard = (cardToFork) => async (dispatch, getState) => {
	//NOTE: if you modify this card you likely also want to modify
	//createWorkingNotesCard too and likely also createForkedCard

	//newCard creates and inserts a new card in the givne section with the given id.

	if (typeof cardToFork !== 'object' || !cardToFork) {
		console.warn('cardToFork wasn\'t valid object');
		return;
	}

	if (!confirm('This will create a forked copy of the current card. OK?')) return;

	const state = getState();

	let id = newID();

	const section = cardToFork.section;
	const cardType = cardToFork.card_type;

	if (!getUserMayEditSection(state, section)) {
		console.log('User doesn\'t have edit permission for section the card will be added to.');
		return;
	}

	let user = selectUser(state);

	if (!user) {
		console.log('No user');
		return;
	}

	if (!selectUserMayCreateCard(state)) {
		console.log('User isn\'t allowed to create card');
		return;
	}

	let sortOrder = getSortOrderImmediatelyAdjacentToCard(state, cardToFork.id, false);

	let obj = defaultCardObject(id,user,section,cardType, sortOrder);
	for (let key of Object.keys(CARD_FIELDS_TO_COPY_ON_FORK)) {
		//We can literally leave these as the same object because they'll just
		//be sent to firestore and the actual card we'll store will be new
		obj[key] = cardToFork[key];
	}
	//references accessor will copy the references on setting something
	//If the card we're copying was itself a fork, we want to overwrite that otherwise it gets confusing.
	references(obj).setCardReferencesOfType(REFERENCE_TYPE_FORK_OF, [cardToFork.id]);
	references(obj).setCardReference(cardToFork.id, REFERENCE_TYPE_MINED_FROM);

	let cardDocRef = db.collection(CARDS_COLLECTION).doc(id);

	//Tell card-view to expect a new card to be loaded, and when data is
	//fully loaded again, it will then trigger the navigation.
	dispatch({
		type: EXPECT_NEW_CARD,
		ID: id,
		cardType: cardType,
		navigate: true,
		noSectionChange: !section,
	});

	let batch = db.batch();
	ensureAuthor(batch, user);
	batch.set(cardDocRef, obj);
	for (let tagName of obj.tags) {
		let tagRef = db.collection(TAGS_COLLECTION).doc(tagName);
		let tagUpdateRef = tagRef.collection(TAG_UPDATES_COLLECTION).doc('' + Date.now());
		let newTagObject = {
			cards: arrayUnionSentinel(id),
			updated: serverTimestampSentinel()
		};
		let newTagUpdateObject = {
			timestamp: serverTimestampSentinel(),
			add_card: id,
		};
		batch.update(tagRef, newTagObject);
		batch.set(tagUpdateRef, newTagUpdateObject);
	}

	if (section) {
		let sectionRef = db.collection(SECTIONS_COLLECTION).doc(obj.section);
		batch.update(sectionRef, {
			cards: arrayUnionSentinel(id),
			updated: serverTimestampSentinel()
		});
		let sectionUpdateRef = sectionRef.collection(SECTION_UPDATES_COLLECTION).doc('' + Date.now());
		batch.set(sectionUpdateRef, {
			timestamp: serverTimestampSentinel(), 
			add_card: id,
		});
	}

	batch.commit();
	return;


	//updateSections will be called and update the current view. card-view's
	//updated will call navigateToNewCard once the data is fully loaded again
	//(if EXPECT_NEW_CARD was dispatched above)
};

export const deleteCard = (card) => async (dispatch, getState) => {

	const state = getState();

	let reason = getReasonUserMayNotDeleteCard(state, card);

	if (reason) {
		console.warn(reason);
		return;
	}

	if (!confirm('Are you sure you want to delete this card? This action cannot be undone.')) {
		return;
	}

	//If editing, cancel editing
	if (selectIsEditing(state)) {
		dispatch(editingFinish());
	}

	if (selectActiveCardId(state) == card.id) {
		//If we're currently selected, then when we're deleted it will say 'no card found'.
		dispatch(navigateToNextCard());
	}

	let batch = db.batch();
	let ref = db.collection(CARDS_COLLECTION).doc(card.id);
	let updates = await ref.collection(CARD_UPDATES_COLLECTION).get();
	for (let update of updates.docs) {
		batch.delete(update.ref);
	}
	batch.delete(ref);
	batch.commit();

	//Tell the system to expect those cards to be deleted.
	dispatch({
		type: EXPECT_CARD_DELETIONS,
		cards: {
			[card.id]: true,
		}
	});

	//The card update will lead to removeCards being called later

};

export const navigateToNewCard = () => (dispatch, getState) => {
	const ID = selectPendingNewCardIDToNavigateTo(getState());
	if (!ID) return;
	//navigateToNewCard is called when the expected cards/sections are loaded.
	//Ensure that we have the up-to-date sections loaded. The case of adding a
	//card to the current secitno works fine because updateSections will have
	//called refreshCardSelector with force. But it doesn't work automatically
	//for working-notes being added when viewinng working ntoes, since those
	//cards are all oprhaned.
	dispatch(updateCollectionSnapshot());
	//navigateToCard will intiate a chain of actions that culminates in
	//showCard, where we will note that we navigated to new card so we don't do
	//it again.
	dispatch(navigateToCardInCurrentCollection(ID));
};

export const navigatedToNewCard = () => {
	return {
		type:NAVIGATED_TO_NEW_CARD,
	};
};

const modifyCardAction = () => {
	return {
		type: MODIFY_CARD,
	};
};

const modifyCardSuccess = () => (dispatch, getState) => {
	const state = getState();
	if (selectIsEditing(state)) {
		dispatch(editingFinish());
	}
	if (selectMultiEditDialogOpen(state)) {
		dispatch(closeMultiEditDialog());
	}
	dispatch({
		type:MODIFY_CARD_SUCCESS,
	});
};

const modifyCardFailure = (err, skipAlert) => {
	if (skipAlert) {
		console.warn(err);
	} else {
		alert(err);
	}
	return {
		type: MODIFY_CARD_FAILURE,
		error: err,
	};
};

export const reorderStatus = (pending) => {
	return {
		type: REORDER_STATUS,
		pending
	};
};

export const updateSections = (sections) => (dispatch, getState) => {
	dispatch({
		type: UPDATE_SECTIONS,
		sections,
	});

	//If the update is a single section updating and it's the one currently
	//visible then we should update collections. This could happen for example
	//if a new card is added, or if cards are reordered.
	const currentSectionId = selectActiveSectionId(getState());
	const force = Object.keys(sections).length == 1 && sections[currentSectionId];

	dispatch(refreshCardSelector(force));
};

export const updateAuthors = (authors) => (dispatch, getState) => {

	const state = getState();

	const user = selectUser(state);

	if (user && user.uid) {
		const authorRec = authors[user.uid];
		if (authorRec) {
			if ((!authorRec.displayName || !authorRec.photoURL) && (user.displayName || user.photoURL)) {
				//there's an author rec for our user, but it's missing
				//displayName or photoURL, and we have them. This could happen
				//if a user was manually listed as a collaborator or editor
				//without already being in the authors table. We should ensure
				//author!
				console.log('Saving extra author information because our authors rec was missing it');
				let batch = db.batch();
				ensureAuthor(batch, user);
				//don't need to wait for it resolve
				batch.commit();
			}
		}
	}

	dispatch({
		type: UPDATE_AUTHORS,
		authors
	});
};

export const updateTags = (tags) => (dispatch) => {
	dispatch({
		type:UPDATE_TAGS,
		tags,
	});
	dispatch(refreshCardSelector(false));
};

export const updateCards = (cards, unpublished) => (dispatch) => {
	dispatch({
		type:UPDATE_CARDS,
		cards,
		unpublished
	});
	dispatch(refreshCardSelector(false));
};

//This number is used in removeCards. it should be large enough that the race
//between queries for published and unpublished cards should have resolved by
//when it fires.
const REMOVE_CARDS_TIMEOUT = 3000;

export const removeCards = (cardIDs, unpublished) => (dispatch, getState) => {

	//cards that we expected to be deleted won't show up in the other query
	//ever, so we don't have to wait for the timeout and can delete them now.
	//cards that we weren't told were going to be deleted might show up in the
	//other collection, so wait.

	let expectedDeletions = selectExpectedDeletions(getState());

	let nonDeletions = [];
	let deletions = [];

	for (let id of cardIDs) {
		if (expectedDeletions[id]) {
			deletions.push(id);
		} else {
			nonDeletions.push(id);
		}
	}

	if (deletions.length) {
		dispatch(actuallyRemoveCards(deletions, unpublished));
	}

	if (nonDeletions.length) {
		setTimeout(() => {
			dispatch(actuallyRemoveCards(nonDeletions, unpublished));
		}, REMOVE_CARDS_TIMEOUT);
	}
};

//actuallyRemoveCards is the meat of removeCards. It goes through and issues a
//REMOVE_CARDS order for any card whose published property equals the opposite
//of unpublished. Notiobally the logic is: there are two types of live card
//queries: one for published and possibly one for unpublished cards. A given
//card might be removed from either set... but in certain cases it might have
//popped IN in the ohter set (e.g. if the published property was changed). We
//avoid the race between it popping out and then popping in by waiting for
//REMOVE_CARDS_TIMEOUT. By the time this fires, the card will have been
//overwritten with whatever the most recent version of the data is from the
//database, either the published or unpublished variety. The unpublished
//parameter says: "The unpublished query wants you to remove this card". If the
//card in the state wasn't put there by the unpublished side when this runs,
//then it shouldn't be removed, because a more recent copy was put there by the
//published side.
const actuallyRemoveCards = (cardIDs, unpublished) => (dispatch, getState) => {

	const published = !unpublished;
	const cards = selectCards(getState());

	const filteredCardIDs = cardIDs.filter(id => cards[id] ? cards[id].published == published : false);

	//If a card just had its published property changed (meaning it popped from
	//the unpublished to published collection or vice versa), then this would be
	//empty, and no more work is necessary.
	if (!filteredCardIDs.length) return;

	dispatch({
		type: REMOVE_CARDS,
		cardIDs: filteredCardIDs,
	});
};

export const fetchTweets = (card) => async (dispatch) => {

	if (!card || Object.values(card).length == 0) return;

	dispatch({
		type: TWEETS_LOADING,
		loading: true,
	});

	//This query requires an index, defined in firestore.indexes.json
	const snapshot = await db.collection(TWEETS_COLLECTION).where('card', '==', card.id).where('archived', '==', false).orderBy('created', 'desc').get();

	if (snapshot.empty) {
		dispatch({
			type: UPDATE_TWEETS,
			loading: false,
		});
		return;
	}

	const tweets = Object.fromEntries(snapshot.docs.map(doc => [doc.id, doc.data()]));

	dispatch({
		type: UPDATE_TWEETS,
		tweets
	});
};

export const expectUnpublishedCards = () => {
	return {
		type: EXPECT_UNPUBLISHED_CARDS,
	};
};

//Denotes that we just did a pending filters commit when the data was fully
//loaded... and shouldn't do it again.
export const committedFiltersWhenFullyLoaded = () => {
	return {
		type: COMMITTED_PENDING_FILTERS_WHEN_FULLY_LOADED,
	};
};

