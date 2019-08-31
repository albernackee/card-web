import { LitElement, html } from '@polymer/lit-element';

import './card-renderer.js';
import './star-count.js';
import './thread-count.js';
import './read-decorator.js';

import { 
	CARD_WIDTH_IN_EMS,
	CARD_HEIGHT_IN_EMS
} from './base-card.js';

class CardPreview extends LitElement {
	render() {
		const cardWidthInPixels = CARD_WIDTH_IN_EMS * this.previewSize;
		const cardHeightInPixels = CARD_HEIGHT_IN_EMS * this.previewSize;
		const positionLeft = (this.x + cardWidthInPixels) > window.innerWidth;
		const positionUp = (this.y + cardHeightInPixels) > window.innerHeight;

		const starred = this.stars && this.card ? this.stars[this.card.id] : false;
		const read = this.reads && this.card ? this.reads[this.card.id] : false;

		return html`
		<style>
			:host {
				position:absolute;
				left: ${positionLeft ? html`${this.x - cardWidthInPixels - this.cardOffset}` : html`${this.x + this.cardOffset}`}px;
				top: ${positionUp ? html`${this.y - cardHeightInPixels - this.cardOffset}` : html`${this.y + this.cardOffset}`}px;

				/* TODO: this z-index ia a bit of a hack to make sure it shows up
				above e.g. dialogs, which are 1000 */
				z-index: 10001;
			}

			card-renderer {
				/* font-size is the primary way to affect the size of a card-renderer */
				font-size: ${this.previewSize}px;
			}

			.decorators {
				position: absolute;
				bottom: 0.25em;
				right: 0.25em;
			}

      </style>
      <div ?hidden='${!this.card}'>
		<card-renderer .card=${this.card}></card-renderer>
		<div class='decorators'>
			<star-count .count=${this.card ? this.card.star_count : 0} .higlighted=${starred}></star-count>
			<thread-count .count=${this.card ? this.card.thread_count : 0}></thread-count>
			<read-decorator .visible=${read}></read-decorator>
		</div>
      </div>
    `;
	}
	
	constructor() {
		super();
		this.previewSize = 10.0;
		this.cardOffset = 10.0;
	}

	static get properties() { 
		return {
			card: {type: Object},
			x: { type: Number },
			y: { type: Number },
			stars: { type: Object },
			reads: { type: Object },
			/* size of font for card in px*/
			previewSize: { type: Number },
			/* offset from the cursor in pixels */
			cardOffset : { type: Number },
		};
	}


}

window.customElements.define('card-preview', CardPreview);
