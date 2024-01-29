import { gql } from "@apollo/client";

export const GRAPHQL_GET_SPACES = gql`
    query GetSpace {
        core_space {
            name
            date_updated
            id
            space_urls {
                id
            }
        }
    }
`;

export const GRAPHQL_ADD_SPACE = gql`
    mutation InsertSpace($name: String) {
        insert_core_space(objects: {name: $name}) {
            affected_rows
            returning {
                name
                date_created
                date_updated
                id
                user_id
            }
        }
    }
`;

export const GRAPHQL_ADD_PAGE = gql`
    mutation InsertPage($parentId: bigint, $spaceId: uuid, $data: json, $title: String) {
        insert_core_page(objects: {parent_id: $parentId, space_id: $spaceId, docs: {data: {data: $data, title: $title}}}) {
            affected_rows
            returning {
                id
                parent_id
                draft
                status
                date_created
                owner_id
                space_id
            }
        }
    }
`;

export const GRAPHQL_GET_PAGES = gql`
    query get_pages($id: bigint) {
        core_space_url(where: {id: {_eq: $id}}) {
            space {
                name
                id
                pages {
                    id
                    docs(limit: 1, order_by: {version: desc}) {
                        title
                        id
                    }
                }
            }
        }
    }
`;

export const GRAPHQL_GET_PAGE = gql`
    query GetPage($pageId: bigint) {
        core_page(where: {id: { _eq: $pageId }}) {
            id
            parent_id
            draft
            status
            date_created
            owner_id
            space_id
            docs(limit: 1, order_by: {version: desc}) {
                data
                id
                version
                title
            }
        }
    }
`;

export const GRAPHQL_UPDATE_DOC_DATA = gql`
    mutation updateDocData($id: bigint, $pageId: bigint, $data: json, $title: String) {
        update_core_doc(_set: {data: $data, title: $title}, where: {id: {_eq: $id}, page_id: { _eq: $pageId }}) {
            affected_rows
            returning {
                id
            }
        }
    }
`;

export const GRAPHQL_UPDATE_DOC_TITLE = gql`
    mutation UpdateDocTitle($id: bigint, $pageId: bigint, $title: String ) {
        update_core_doc(where: {id: {_eq: $id}, page_id: {_eq: $pageId}}, _set: {title: $title}) {
            affected_rows
            returning {
                id
            }
        }
    }
`

export const GRAPHQL_DELETE_PAGE = gql`
    mutation deletePage($pgId: bigint) {
        delete_core_page(where: {id: {_eq: $pgId}}) {
            affected_rows
        }
  }  
`;

