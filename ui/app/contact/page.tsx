import MenuBar from "@components/menuBar";
import { Box, Button, Flex, Heading, Text } from "@radix-ui/themes";
import { FiArrowLeft, FiMail } from "react-icons/fi";
import Link from "next/link";

const contactEmail = "connect@durgakiran.in";
const mailtoHref = `mailto:${contactEmail}?subject=Teddox%20support%20request`;

export default function ContactPage() {
    return (
        <div className="min-h-screen bg-[#fbfafc]">
            <MenuBar />
            <Box className="mx-auto w-full max-w-5xl px-4 pb-12 pt-24 md:px-8">
                <Flex direction="column" gap="6">
                    <Link
                        href="/space"
                        className="inline-flex w-fit items-center gap-2 text-sm font-medium text-[#605c67] transition-colors hover:text-[#221f26]"
                    >
                        <FiArrowLeft size={15} />
                        Back to spaces
                    </Link>

                    <Flex direction="column" gap="3" className="max-w-2xl">
                        <Text size="2" weight="bold" className="uppercase tracking-wide !text-[#6b4c7a]">
                            Contact
                        </Text>
                        <Heading as="h1" size="8" className="!text-[#221f26]">
                            Get help with Teddox
                        </Heading>
                        <Text size="3" className="!text-[#605c67]">
                            Send workspace, account, billing, or access questions to the support inbox. Include the
                            workspace name and page link when the issue is tied to a specific document.
                        </Text>
                    </Flex>

                    <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
                        <section className="rounded-[12px] border border-[#d4d1da] bg-white p-5 shadow-[0_10px_24px_rgba(34,31,38,0.04)] md:p-6">
                            <Flex direction="column" gap="4">
                                <Flex align="center" gap="3">
                                    <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#efe9f2] text-[#6b4c7a]">
                                        <FiMail size={18} />
                                    </span>
                                    <Box>
                                        <Text as="div" size="3" weight="bold" className="!text-[#221f26]">
                                            Email support
                                        </Text>
                                        <Text as="div" size="2" className="!text-[#605c67]">
                                            {contactEmail}
                                        </Text>
                                    </Box>
                                </Flex>

                                <Text size="2" className="!text-[#605c67]">
                                    This opens your email client with a support request subject so the message can be
                                    handled from your normal inbox.
                                </Text>

                                <Button asChild size="3" className="w-fit">
                                    <a href={mailtoHref}>
                                        <FiMail size={15} />
                                        Email support
                                    </a>
                                </Button>
                            </Flex>
                        </section>

                        <aside className="rounded-[12px] border border-[#d4d1da] bg-[#f8f7f9] p-5 md:p-6">
                            <Flex direction="column" gap="3">
                                <Text size="3" weight="bold" className="!text-[#221f26]">
                                    Useful details to include
                                </Text>
                                <ul className="space-y-2 text-sm leading-6 text-[#605c67]">
                                    <li>Workspace or space name</li>
                                    <li>Page URL, if a document is affected</li>
                                    <li>What you expected to happen</li>
                                    <li>Screenshot or error text, when available</li>
                                </ul>
                            </Flex>
                        </aside>
                    </div>
                </Flex>
            </Box>
        </div>
    );
}
