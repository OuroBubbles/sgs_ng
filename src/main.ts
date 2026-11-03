import { mount } from 'svelte';
import App from './app/App.svelte';
import './client/style.css';
import './client/refinements.css';
import './client/table/surface.css';

const target = document.getElementById('app');

if (!target) {
  throw new Error('缺少应用挂载点。');
}

mount(App, { target });
