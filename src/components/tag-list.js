
import { LitElement, html } from '@polymer/lit-element';

import './tag-chip.js';

import {
	arrayDiff, 
	arrayToSet
} from '../util.js';

class TagList  extends LitElement {
	render() {
		let effectiveTags = this.tags;
		let effectivePreviousTags = this.previousTags ? (this.previousTags.length ? this.previousTags : []) : effectiveTags;
		let [additionsArray, deletionsArray] = arrayDiff(effectivePreviousTags, effectiveTags);
		let additions = arrayToSet(additionsArray);
		let deletions = arrayToSet(deletionsArray);
		let allTags = [];
		if (effectiveTags && deletionsArray) allTags = [...effectiveTags, ...deletionsArray];
		let tagInfos = this.tagInfos || {};
		return html`
			<style>
				select {
					display:none;
				}
				.editing select {
					display:inline;
				}
				tag-chip {
					transition: filter 0.1s ease-in-out;
				}
				.subtle tag-chip {
					filter:grayscale(80%) opacity(40%);
				}
				tag-chip:hover {
					filter:none;
				}
			</style>
			<div class='${this.editing ? 'editing' : ''} ${this.subtle ? 'subtle' :''}'>
			${allTags && allTags.length ?
		allTags.map(item => html`<tag-chip .card=${this.card} .tagName=${item} .tagInfos=${this.tagInfos} .addition=${additions[item]} .deletion=${deletions[item]} .editing=${this.editing}></tag-chip>`) :
		(this.subtle ? html`` : html`<em>No ${this.typeName.toLowerCase()}s</em>`)}
			<select @change=${this._handleSelectChanged}>
				<option value='#noop' selected>Add ${this.typeName}...</option>
				${Object.keys(tagInfos).map(item => html`<option value='${tagInfos[item].id}'>${tagInfos[item].title}</option>`)}
				${this.diableNew ? '' : html`<option value='#new'>New ${this.typeName}</option>`}
			</select>
			</div>
			`;
	}

	_handleSelectChanged(e) {
		let ele = e.composedPath()[0];
		if (ele.value == '#noop') return;
		let value = ele.value;
		//Set it back to #noop.
		ele.value = '#noop';
		if (value == '#new') {
			if (this.disableNew) {
				console.warn('New tag selected evey though it was supposed to be disabled');
				return;
			}
			this.dispatchEvent(new CustomEvent('new-tag', {composed:true}));
			return;
		}
		//Note: a similar event is fired in tag-chip when editing and hitting
		//the x and deletion is true.
		this.dispatchEvent(new CustomEvent('add-tag', {composed: true, detail:{tag: value}}));
	}

	get typeName() {
		return this.overrideTypeName || 'Tag';
	}

	static get properties() {
		return {
			tags: { type: Array },
			//If set, will be considereed the uncommitted tags, and will have a diff rendered againast them.
			previousTags: {type:Array},
			tagInfos: {type:Object},
			editing: {type:Boolean},
			subtle: {type:Boolean},
			//If set, typeName will be used in the UI to describe the types of things the tags represent, e.g. "New FOO". If not set, will default to "Tag".
			overrideTypeName: {type:String},
			//If true, then the select option to add a new tag will not be shown.
			disableNew: {type:Boolean},
			card: {type:Object},
		};
	}
}

window.customElements.define('tag-list', TagList);
