'use client'
import styled from 'styled-components';


interface ISpaceBox {
    name: string;
}
const StyledSpaceBox = styled.div`
    border-width: 0.5px;
    margin: 1px;
    border-style: solid;
    border-color: ${({ theme }) => theme.colors.border.muted};
    padding-left: 2px;
    padding-right: 2px;
    box-sizing: border-box;
`;

export default function SpaceBox({ name }: ISpaceBox) {
    return (
        <StyledSpaceBox>
            <div className="name">{name}</div>
            <p>
                Some space description...
            </p>
        </StyledSpaceBox>
    )
}  
