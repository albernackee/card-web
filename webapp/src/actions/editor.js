export const EDITING_START = 'EDITING_START';
export const EDITING_FINISH = 'EDITING_FINISH';

import {
  userMayEdit
} from '../reducers/user.js';

import {
  cardSelector
} from '../reducers/data.js'

export const editingStart = () => (dispatch, getState) => {
  const state = getState();
  if (!userMayEdit(state)) {
    console.warn("This user is not allowed to edit!")
    return;
  }
  const card = cardSelector(state)
  if (!card || !card.id) {
    console.warn("There doesn't appear to be an active card.");
    return;
  }
  dispatch({type: EDITING_START, card: card});
}

export const editingFinish = () => {
  return {type: EDITING_FINISH}
}
