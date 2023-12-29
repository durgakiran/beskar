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

export const GRAPHQL_GET_PAGES = gql`
    query get_pages($id: bigint) {
        core_space_url(where: {id: {_eq: $id}}) {
            space {
                name
                id
            }
        }
    }
`;