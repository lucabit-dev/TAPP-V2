<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tainy - Wikipedia</title>
    <style>
        :root {
            --wiki-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Lato, Helvetica, Arial, sans-serif;
            --wiki-border: #a2a9b1;
            --wiki-bg: #f8f9fa;
            --wiki-content-bg: #ffffff;
            --link-color: #0645ad;
            --visited-color: #0b0080;
        }

        body {
            margin: 0;
            padding: 0;
            background-color: #f6f6f6;
            font-family: var(--wiki-font);
            color: #202122;
            font-size: 0.875rem;
            line-height: 1.6;
        }

        /* Layout */
        .layout-container {
            display: flex;
            max-width: 100%;
        }

        /* Sidebar */
        .sidebar {
            width: 11em;
            padding: 1em 0.5em;
            flex-shrink: 0;
            background-color: #f6f6f6;
        }

        .sidebar-logo {
            width: 135px;
            height: 135px;
            margin: 0 auto 1em;
            background: url('https://upload.wikimedia.org/wikipedia/en/thumb/8/80/Wikipedia-logo-v2.svg/1200px-Wikipedia-logo-v2.svg.png') no-repeat center;
            background-size: contain;
            opacity: 0.9;
        }

        .sidebar-menu {
            list-style: none;
            padding: 0;
            margin: 0 0 1em 0.5em;
            font-size: 0.85em;
        }

        .sidebar-menu li {
            margin-bottom: 0.2em;
        }

        .sidebar-menu a {
            text-decoration: none;
            color: #0645ad;
        }

        .sidebar-menu a:hover {
            text-decoration: underline;
        }

        .sidebar-header {
            font-size: 0.75em;
            color: #54595d;
            margin: 0.5em 0.5em 0.2em;
            border-bottom: 1px solid #c8ccd1;
            padding-bottom: 0.2em;
        }

        /* Main Content */
        .main-content {
            flex-grow: 1;
            background-color: var(--wiki-content-bg);
            border: 1px solid var(--wiki-border);
            border-right: none;
            border-bottom: none;
            min-height: 100vh;
            padding: 1.5em 2em;
            position: relative;
        }

        /* Top Bar (Tabs/Search) */
        .top-bar {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-bottom: 1em;
            border-bottom: 1px solid var(--wiki-border);
            height: 2.5em;
        }

        .tabs-left {
            display: flex;
            gap: 4px;
        }

        .tabs-right {
            display: flex;
            gap: 4px;
            align-items: center;
        }

        .tab {
            padding: 0.5em 1em;
            background: var(--wiki-content-bg);
            border: 1px solid var(--wiki-border);
            border-bottom: none;
            margin-bottom: -1px;
            cursor: pointer;
            color: #0645ad;
            white-space: nowrap;
        }

        .tab.active {
            border-bottom: 1px solid white;
            color: #202122;
            font-weight: bold;
        }

        .search-box {
            padding: 0.3em;
            border: 1px solid var(--wiki-border);
            margin-bottom: 0.2em;
            font-family: inherit;
            width: 15em;
        }

        /* Article Content */
        h1.firstHeading {
            font-size: 1.8em;
            font-weight: 400;
            font-family: 'Linux Libertine', 'Georgia', 'Times', serif;
            border-bottom: 1px solid var(--wiki-border);
            margin-top: 0;
            padding-bottom: 0.2em;
            margin-bottom: 0.5em;
        }

        #siteSub {
            font-size: 0.8em;
            color: #54595d;
            margin-bottom: 1em;
        }

        h2 {
            font-size: 1.5em;
            font-weight: 400;
            font-family: 'Linux Libertine', 'Georgia', 'Times', serif;
            border-bottom: 1px solid var(--wiki-border);
            padding-bottom: 0.3em;
            margin-top: 1em;
            margin-bottom: 0.5em;
        }

        h3 {
            font-size: 1.2em;
            font-weight: bold;
            margin-top: 1em;
            margin-bottom: 0.5em;
        }

        p {
            margin: 0.5em 0 1em;
        }

        a {
            color: var(--link-color);
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }

        /* Infobox */
        .infobox {
            border: 1px solid var(--wiki-border);
            background-color: #f8f9fa;
            float: right;
            clear: right;
            margin: 0 0 1em 1em;
            width: 22em;
            padding: 0.2em;
            font-size: 88%;
            line-height: 1.5em;
        }

        .infobox-title {
            text-align: center;
            font-size: 125%;
            font-weight: bold;
            padding: 0.2em;
            background-color: #b0c4de;
            margin-bottom: 0.5em;
        }

        .infobox-image {
            text-align: center;
            padding-bottom: 0.5em;
        }

        .infobox-image img {
            max-width: 220px;
            height: auto;
            background-color: #ccc; /* Placeholder */
        }

        .infobox table {
            width: 100%;
            border-collapse: collapse;
        }

        .infobox th {
            text-align: left;
            vertical-align: top;
            padding: 0.2em 0.4em;
        }

        .infobox td {
            vertical-align: top;
            padding: 0.2em 0.4em;
        }

        .toc {
            border: 1px solid var(--wiki-border);
            background-color: #f8f9fa;
            display: inline-block;
            padding: 7px;
            margin: 1em 0;
        }

        .toc h2 {
            text-align: center;
            font-size: 100%;
            font-weight: bold;
            border: none;
            margin: 0;
            padding: 0;
            font-family: sans-serif;
        }

        .toc ul {
            list-style: none;
            padding-left: 0;
            margin-top: 0.5em;
        }

        .toc li {
            margin-bottom: 0.2em;
        }

        .toc-number {
            color: #202122;
            margin-right: 0.3em;
        }

        /* References */
        .references {
            font-size: 90%;
        }

        .reflist {
            column-count: 2;
            list-style-type: decimal;
            padding-left: 2em;
        }

        /* Responsive */
        @media (max-width: 768px) {
            .layout-container {
                flex-direction: column;
            }
            .sidebar {
                display: none; /* Hide sidebar on mobile for simplicity */
            }
            .infobox {
                float: none;
                width: 100%;
                margin: 0 0 1em 0;
                box-sizing: border-box;
            }
            .main-content {
                padding: 1em;
                border: none;
            }
            .top-bar {
                display: none; /* Simplify mobile view */
            }
        }
    </style>
</head>
<body>
    <div class="layout-container">
        <!-- Sidebar -->
        <div class="sidebar">
            <div class="sidebar-logo"></div>
            <div class="sidebar-menu">
                <li><a href="#">Main page</a></li>
                <li><a href="#">Contents</a></li>
                <li><a href="#">Current events</a></li>
                <li><a href="#">Random article</a></li>
                <li><a href="#">About Wikipedia</a></li>
                <li><a href="#">Contact us</a></li>
                <li><a href="#">Donate</a></li>
            </div>
            <div class="sidebar-header">Contribute</div>
            <div class="sidebar-menu">
                <li><a href="#">Help</a></li>
                <li><a href="#">Learn to edit</a></li>
                <li><a href="#">Community portal</a></li>
                <li><a href="#">Recent changes</a></li>
                <li><a href="#">Upload file</a></li>
            </div>
        </div>

        <!-- Main Content -->
        <main class="main-content">
            <div class="top-bar">
                <div class="tabs-left">
                    <div class="tab active">Article</div>
                    <div class="tab">Talk</div>
                </div>
                <div class="tabs-right">
                    <div class="tab active">Read</div>
                    <div class="tab">Edit</div>
                    <div class="tab">View history</div>
                    <input type="text" class="search-box" placeholder="Search Wikipedia">
                </div>
            </div>

            <h1 class="firstHeading">Tainy</h1>
            <div id="siteSub">From Wikipedia, the free luquipedia</div>

            <!-- Infobox -->
            <div class="infobox">
                <div class="infobox-title">Tainy</div>
                <div class="infobox-image">
                    <!-- Placeholder for Tainy's image -->
                    <div style="width: 220px; height: 280px; background-color: #ddd; display: flex; align-items: center; justify-content: center; color: #666; margin: 0 auto;">
                        [Image: Tainy]
                    </div>
                    <div style="font-size: 0.9em; padding-top: 5px;">Tainy in 2021</div>
                </div>
                <table>
                    <tr>
                        <th scope="row">Birth name</th>
                        <td>Marco Efraín Masís Fernández</td>
                    </tr>
                    <tr>
                        <th scope="row">Born</th>
                        <td>August 9, 1989 (age 34)<br>San Juan, Puerto Rico</td>
                    </tr>
                    <tr>
                        <th scope="row">Occupations</th>
                        <td>
                            Record producer<br>
                            Songwriter
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Years active</th>
                        <td>2003–present</td>
                    </tr>
                    <tr>
                        <th scope="row">Labels</th>
                        <td>Neon16, Roc Nation, Y Entertainment</td>
                    </tr>
                    <tr>
                        <th scope="row">Associated acts</th>
                        <td>
                            Bad Bunny • J Balvin • Wisin & Yandel • Daddy Yankee • Luny Tunes • Kris Floyd
                        </td>
                    </tr>
                </table>
            </div>

            <p><strong>Marco Efraín Masís Fernández</strong> (born August 9, 1989), known professionally as <strong>Tainy</strong>, is a Puerto Rican record producer and songwriter. Born and raised in <a href="#">San Juan, Puerto Rico</a>, he entered the world of <a href="#">reggaeton</a> with his work on <em>Mas Flow 2</em>.</p>
            
            <p>Leading a new wave of Latin music for over a decade, Tainy has been the producer of some of the biggest reggaeton hits. A repeated <a href="#">Grammy</a> and <a href="#">BMI Award</a> winner, Tainy has produced for countless artists, including reggaeton pioneers like <a href="#">Daddy Yankee</a>, <a href="#">Wisin & Yandel</a>, <a href="#">Don Omar</a>, and others. Recently, he has contributed to global hits like "I Like It" by <a href="#">Cardi B</a> featuring <a href="#">Bad Bunny</a> and <a href="#">J Balvin</a> and "No Es Justo" by J Balvin featuring <a href="#">Zion & Lennox</a>.</p>

            <!-- Table of Contents -->
            <div class="toc">
                <h2>Contents</h2>
                <ul>
                    <li><a href="#Early_life"><span class="toc-number">1</span> <span class="toc-text">Early life</span></a></li>
                    <li><a href="#Career"><span class="toc-number">2</span> <span class="toc-text">Career</span></a></li>
                    <li><a href="#Discography"><span class="toc-number">3</span> <span class="toc-text">Discography</span></a></li>
                    <li><a href="#Awards_and_nominations"><span class="toc-number">4</span> <span class="toc-text">Awards and nominations</span></a></li>
                    <li><a href="#References"><span class="toc-number">5</span> <span class="toc-text">References</span></a></li>
                </ul>
            </div>

            <h2 id="Early_life">Early life</h2>
            <p>Tainy was born and raised in San Juan, Puerto Rico. His career began to take off after he gave his first demo to Nely, who liked what he heard. He was raised in a musically inclined family, with his mother, María Fernández, playing a significant role in his upbringing. Tainy has a younger brother, Michael Bryan, also a record producer known as "Mvsis." He is of Puerto Rican ethnicity and follows Christianity. Growing up, he was influenced by various musical genres, including reggaeton, rock, and R&B.</p>

            <h2 id="Career">Career</h2>
            <p>Tainy's career began at a young age when he met producer Nely "El Arma Secreta" at a local church. Nely introduced him to the duo <a href="#">Luny Tunes</a>, who recognized his talent and signed him to their team. At 15, Tainy started using FL Studio XXL to produce music and contributed to Luny Tunes' album <em>Mas Flow 2</em>. He co-produced the album <em>Los Benjamins</em> and has since worked with artists like Wisin & Yandel, Janet Jackson, Jennifer Lopez, and Paris Hilton.</p>
            
            <p>In 2019, Tainy and music executive Lex Borrero launched <strong>Neon16</strong>, a multifaceted talent incubator. The label partnered with Interscope Records and signed artists such as Álvaro Díaz and Dylan Fuentes. Tainy has produced global hits like "I Like It" by Cardi B, featuring Bad Bunny and J Balvin, and "No Es Justo" by J Balvin, featuring Zion and Lennox. He also produced the collaborative album <em>Oasis</em> with Bad Bunny and J Balvin and the hit single "Callaíta" with Bad Bunny. His debut EP, <em>Neon16 Tape: The Kids That Grew Up on Reggaeton</em>, was released in 2020.</p>

            <h2 id="Discography">Discography</h2>
            <h3>Studio albums</h3>
            <ul>
                <li><em>Mas Flow: Los Benjamins</em> (with Luny Tunes) (2006)</li>
                <li><em>Dynasty</em> (with Yandel) (2021)</li>
                <li><em>Data</em> (2023)</li>
            </ul>

            <h3>EPs</h3>
            <ul>
                <li><em>The Kids That Grew Up on Reggaeton</em> (2020)</li>
                <li><em>Club Dieciséis</em> (2020)</li>
            </ul>

            <h2 id="Awards_and_nominations">Awards and nominations</h2>
            <p>Tainy has received multiple accolades, including:</p>
            <ul>
                <li><strong>Grammy Awards:</strong> Won Best Música Urbana Album in 2023 for Bad Bunny's <em>Un Verano Sin Ti</em>.</li>
                <li><strong>Latin Grammy Awards:</strong> Won Best Urban Music Album multiple times (2018, 2019, 2021, 2022).</li>
                <li><strong>Billboard Latin Music Awards:</strong> Producer of the Year (2021, 2022).</li>
            </ul>

            <h2 id="References">References</h2>
            <div class="references">
                <ol class="reflist">
                    <li><a href="#">"Tainy - Biography"</a>. AllMusic. Retrieved 2023-10-27.</li>
                    <li><a href="#">"Neon16's Tainy & Lex Borrero on the Success of 'Agua'"</a>. Billboard.</li>
                    <li><a href="#">"How Tainy Became Reggaeton's Most Wanted Producer"</a>. Rolling Stone.</li>
                </ol>
            </div>
        </main>
    </div>
</body>
</html>
