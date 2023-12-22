import './shortcut.css';

export interface ShortcutConfig {
    text: string;
    image: string;
}

export class Shortcut {
    config: ShortcutConfig[];

    containerId: string = 'shortcut-container';

    constructor(config: ShortcutConfig[]) {
        this.config = config;
    }

    getId(): string {
        return this.containerId;
    }

    render(): HTMLElement {
        const shortcutContainer = document.createElement('div');
        shortcutContainer.setAttribute('id', this.containerId);
        shortcutContainer.classList.add('shortcut-overlay');
        shortcutContainer.style.setProperty('--styled-overlay-visibility', 'hidden');
        const sentinal = document.createElement('span');
        sentinal.classList.add('shortcut-sentinal');
        shortcutContainer.appendChild(sentinal);
        const listContainer = document.createElement('div');
        shortcutContainer.appendChild(listContainer);
        const listElement = document.createElement('ul');
        listElement.classList.add('shortcut-list-box');
        for (const c of this.config) {
            const element = document.createElement('li');
            element.classList.add('shortcut-list-item');
            const itemDividerContainer = document.createElement('div');
            itemDividerContainer.classList.add('item-box-divider-contianer');
            element.appendChild(itemDividerContainer);
            const itemBox = document.createElement('div');
            itemBox.classList.add('item-box');
            itemDividerContainer.appendChild(itemBox);
            const firstSpan = document.createElement('span');
            firstSpan.classList.add('item-box-text');
            firstSpan.innerText = c.text.toUpperCase();
            itemBox.appendChild(firstSpan);
            if (c.image && c.image !== '') {
                // create image tag
            }
            listElement.appendChild(element);
        }
        listContainer.appendChild(listElement);
        return shortcutContainer;
    }
}
