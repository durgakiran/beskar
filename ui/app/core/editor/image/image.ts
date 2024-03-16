import Image from "@tiptap/extension-image"

export const customImage = Image.extend({
    addNodeView() {
        return ({ node, HTMLAttributes, getPos, editor }) => {
            const container = document.createElement("div");
            container.setAttribute("class", "image-wrapper");
            const imageContainer = document.createElement("div");
            imageContainer.setAttribute("class", "image-container px-2");
            imageContainer.setAttribute("contentEditable", "true");
            container.appendChild(imageContainer);

            container.addEventListener('click', evemt => {
                console.log("clicked over image");
            });

            const content = document.createElement('div');
            if (editor.isEditable) {
                content.setAttribute("class", "image-actual-container");
            }
            imageContainer.append(content);

            const { src, alt, title } = HTMLAttributes;

            const image = document.createElement('img');
            image.src = src;
            image.alt = alt;
            image.classList.add("rounded");
            const subTitle = document.createElement("h6")
            subTitle.innerText = title || "image";
            content.appendChild(image);
            imageContainer.appendChild(subTitle);
            container.style.maxWidth = "100%";
            image.style.objectFit = "contain";


            return {
                dom: container,
                contentDOM: content,
            }
        }
    },
});
