import { LitElement, html } from '@polymer/lit-element';

// This element is *not* connected to the Redux store.
export class BaseCard extends LitElement {
  render() {
    return html`
      <style>
        :host {
          display:block;
          background-color: var(--card-color);
          height: 540px;
          width: 960px;
          box-shadow: var(--card-shadow);
          box-sizing: border-box;
          padding: 23px 33px;
          margin:2em auto;
        }

        .container {
          height:100%;
          width:100%;

        }
      </style>
      <div class="container">
        ${this.innerRender()}
      </div>
    `;
  }

  innerRender() {
    //Subclasess override this
    return "";
  }

}

window.customElements.define('base-card', BaseCard);
