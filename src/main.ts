import { mount } from 'svelte';
import App from './app/App.svelte';
const target = document.getElementById('app');

if (!target) {
  throw new Error('缺少应用挂载点。');
}

mount(App, { target });
