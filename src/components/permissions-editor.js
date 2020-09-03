
import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
	selectAllPermissions,
	selectAuthors
} from '../selectors.js';

import {
	EDIT_ICON
} from './my-icons.js';

import {
	updateUserNote,
	addEnabledPermission,
	addDisabledPermission,
	clearPermission
} from '../actions/permissions.js';

import {
	PERMISSIONS_INFO
} from '../permissions.js';

import './tag-list.js';

const ALL_PERMISSIONS = Object.fromEntries(Object.entries(PERMISSIONS_INFO).map(entry => [entry[0], {...entry[1], id: entry[0], title:entry[1].displayName}]));
const MODIFIABLE_PERMISSIONS = Object.fromEntries(Object.entries(ALL_PERMISSIONS).filter(entry => !entry[1].locked));
const LOCKED_PERMISSIONS = Object.fromEntries(Object.entries(ALL_PERMISSIONS).filter(entry => entry[1].locked));

class PermissionsEditor extends connect(store)(LitElement) {
	render() {
		const lockedPermissionColor = '#7f7f7f';
		const enabledPermissionColor = '#006400'; //darkgreen
		const disabledPermissionColor = '#b22222'; //firebrick

		return html`
			<style>

				:host {
					display: block;
					margin-top: 1em;
				}

				p {
					margin: 0;
				}

				.container {
					color: var(--app-dark-text-color-subtle);
				}

				.editable {
					color: var(--app-dark-text-color);
				}

				.edit {
					cursor: pointer;
				}

				[hidden] {
					display: none;
				}

				svg {
					height:1.3em;
					width:1.3em;
					fill: var(--app-dark-text-color-subtle);
				}

				svg:hover {
					fill: var(--app-dark-text-color);
				}
			</style>
			<div class="container ${this._editable ? 'editable' : ''}">
				<p><strong>${this._title}</strong> ${this.description ? html`<em>${this.description}</em>` : ''}&nbsp;&nbsp;&nbsp;<strong>Notes</strong> ${this._effectivePermissions.notes || html`<em>No notes</em>`} <span class='edit' ?hidden=${!this._editable} @click=${this._handleEditNotes}>${EDIT_ICON}</span></p>
				<tag-list .tags=${this._enabledLockedPermissions} .tagInfos=${LOCKED_PERMISSIONS} .overrideTypeName=${'Permission'} .defaultColor=${lockedPermissionColor} .hideOnEmpty=${true}></tag-list>
				<tag-list .tags=${this._enabledModifiablePermissions} .tagInfos=${MODIFIABLE_PERMISSIONS} .editing=${this._editable} .disableNew=${true} @add-tag=${this._handleAddEnabled} @remove-tag=${this._handleRemove} .overrideTypeName=${'Permission'} .defaultColor=${enabledPermissionColor}></tag-list>
				<tag-list .tags=${this._disabledModifiablePermissions} .tagInfos=${MODIFIABLE_PERMISSIONS} .editing=${this._editable} .disableNew=${true} @add-tag=${this._handleAddDisabled} @remove-tag=${this._handleRemove} .overrideTypeName=${'Permission'} .defaultColor=${disabledPermissionColor} .hideOnEmpty=${true}></tag-list>
			</div>
			`;
	}

	static get properties() {
		return {
			//If provided, will use this
			permissions: { type: Object },
			//If provided, will title it this
			title: { type: String },
			description: { type: String},
			//If provided, will show the permissions for the given user
			uid: { type: String },
			_allPermissions: { type: Object },
			_authors: { type: Object },
		};
	}

	get _editable() {
		return !this.permissions;
	}

	get _title() {
		if (this.title) return this.title;
		const authorInfo = this._authors[this.uid];
		if (authorInfo) {
			return authorInfo.displayName + ' (' + this.uid + ')';
		}
		return this.uid || 'Generic Permissions';
	}

	get _effectivePermissions() {
		return this.permissions || this._allPermissions[this.uid];
	}

	get _enabledModifiablePermissions() {
		return Object.entries(this._effectivePermissions).filter(entry => entry[1]).map(entry => entry[0]).filter(item => MODIFIABLE_PERMISSIONS[item]);
	}

	get _disabledModifiablePermissions() {
		return Object.entries(this._effectivePermissions).filter(entry => !entry[1]).map(entry => entry[0]).filter(item => MODIFIABLE_PERMISSIONS[item]);
	}

	get _enabledLockedPermissions() {
		return Object.keys(this._effectivePermissions).filter(item => LOCKED_PERMISSIONS[item]);
	}

	stateChanged(state) {
		this._allPermissions = selectAllPermissions(state);
		this._authors = selectAuthors(state);
	}

	_handleEditNotes() {
		if (!this._editable) return;
		const notes = prompt('What should notes be?', this._effectivePermissions.notes);
		store.dispatch(updateUserNote(this.uid, notes));
	}

	_handleAddDisabled(e){
		store.dispatch(addDisabledPermission(this.uid, e.detail.tag));
	}

	_handleAddEnabled(e){
		store.dispatch(addEnabledPermission(this.uid, e.detail.tag));
	}

	_handleRemove(e){
		store.dispatch(clearPermission(this.uid, e.detail.tag));
	}

}

window.customElements.define('permissions-editor', PermissionsEditor);
