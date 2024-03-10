import Image from "@tiptap/extension-image"

export const customImage = Image.extend({
    addNodeView() {
        return ({ node, HTMLAttributes, getPos, editor }) => {
            const container = document.createElement("div");
            container.setAttribute("class", "image-wrapper");
            const imageContainer = document.createElement("div");
            imageContainer.setAttribute("class", "image-container");
            container.appendChild(imageContainer);

            container.addEventListener('click', evemt => {
                console.log("clicked over image");
            });

            const content = document.createElement('div')
            imageContainer.append(content);

            const { src, alt, title } = HTMLAttributes;

            const image = document.createElement('img');
            image.src = src;
            image.alt = alt;
            const subTitle = document.createElement("h6")
            subTitle.innerText = title || "image";
            content.appendChild(image);
            content.appendChild(subTitle);
            container.style.maxWidth = "100%";
            image.style.objectFit = "contain";


            return {
                dom: container,
                contentDOM: content,
            }
        }
    },
});
