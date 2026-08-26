# ==============================================================================
#                      WELCOME TO PYTHON & CODING, NADIA! 🐍
# ==============================================================================
#
# This file is an interactive guide designed to take you from absolute zero 
# to writing your own basic computer programs.
#
# How to use this file:
# 1. Read through the comments (lines starting with # are notes for humans).
# 2. Look at the code lines (the lines the computer actually runs).
# 3. Try running the code yourself to see what it prints out!
#
# ==============================================================================
# PART 1: THE BIG PICTURE — WHAT IS CODING & PYTHON?
# ==============================================================================
#
# 💡 WHAT IS CODING?
# Computers are incredibly fast, but they are also incredibly simple-minded. 
# They cannot think for themselves. Coding (or programming) is simply writing 
# a step-by-step recipe of instructions for a computer to follow.
#
# 💡 WHAT IS PYTHON?
# Python is a popular programming language. Think of it like English, Spanish, 
# or French, but designed for talking to computers. It was created in 1991 by 
# Guido van Rossum. He wanted a language that is:
#   1. Extremely easy to read (it looks a lot like plain English!).
#   2. Fast to write.
#   3. Versatile (used for websites, AI, games, science, data analysis, and more).
#
# 💡 HOW DOES THE COMPUTER READ PYTHON?
# 1. The Source Code: That's this file (`python_basics.py`). It's just plain text.
# 2. The Interpreter: The computer cannot understand human language directly. 
#    When you run Python, a special program called the "Interpreter" reads your 
#    code line-by-line, from top to bottom.
# 3. Translation: The interpreter translates Python code into "Machine Code" 
#    (ones and zeros: 0101001) that the computer's CPU (brain) can execute.
#
# 💡 RULES OF THE PYTHON LANGUAGE:
# - Top-to-Bottom: The computer executes instructions in order, starting at line 1.
# - Case-Sensitive: To Python, `Print` is not the same as `print`. Spelling matters!
# - Whitespace (Indentation): Indentation (tabs or spaces) is used to group instructions.
# - Comments: Any line starting with `#` is ignored by the computer. It is just
#   for us humans to explain what is happening!
#
# ==============================================================================
# PART 2: HELLO, WORLD! (YOUR VERY FIRST LINE OF CODE)
# ==============================================================================
#
# To tell a computer to display text on the screen, we use the `print()` function.
# Think of a function like a machine: you feed it something (inside the parentheses),
# and it performs an action.
#
# Below is the official first code. The text is surrounded by quotes "" to show
# Python it is a "String" (a string of characters/text), not a command.

print("Hello, World!")  # <- Run this! It will print Hello, World! on the screen.

# ❓ QUESTION FOR NADIA:
# What happens if you remove the quotation marks inside print(Hello, World!)?
# Answer: The computer gets confused. It thinks "Hello" and "World" are commands 
# instead of text, and will throw a Syntax Error. Quotation marks tell Python: 
# "This is just literal text, don't try to run it as code!"

print("Welcome to Python, Nadia! You are officially a programmer now.")

# ==============================================================================
# PART 3: VARIABLES (THE COMPUTER'S MEMORY BOXES)
# ==============================================================================
#
# Imagine your computer's memory is a massive warehouse. A "variable" is just 
# a labeled cardboard box where you can store a piece of information.
#
# To make a variable, you choose a name, use the `=` sign, and give it a value.
# Name of Box  =  What goes inside
#
name = "Nadia"
age = 25
is_learning_python = True

# Let's inspect what is in those boxes by printing them!
print(name)
print(age)

# We can also combine text and variables together in a print statement.
# We do this using an "f-string" (format string). Put an 'f' before the quotes,
# and put variables inside curly braces {}:
print(f"My friend's name is {name} and she is {age} years old.")

# 💡 DATA TYPES (What can go in the box?):
# 1. String (str): Text, always inside quotes. e.g., "Nadia"
# 2. Integer (int): Whole numbers, no decimal. e.g., 25, -5, 1000
# 3. Float (float): Numbers with decimals. e.g., 99.9, 3.14
# 4. Boolean (bool): Yes/No or True/False answers. e.g., True, False

# ❓ QUESTION FOR NADIA:
# What is the difference between these two variables?
# box_one = 10
# box_two = "10"
#
# Answer: `box_one` is an Integer (a number you can do math with). 
# `box_two` is a String (text, like a house number or phone number). 
# If you try to add them, Python will give you an error!

# ==============================================================================
# PART 4: BASIC MATH & OPERATIONS
# ==============================================================================
#
# Python makes a great calculator. We use standard symbols for math:
#  +  Addition
#  -  Subtraction
#  *  Multiplication
#  /  Division
#  ** Exponent (raising to a power, like 2 to the power of 3)
#  %  Modulo (finds the remainder of a division, e.g., 5 % 2 = 1)

cookies = 10
friends = 4

# Let's calculate how many cookies each friend gets if we share equally:
cookies_per_friend = cookies / friends
print(f"Each friend gets {cookies_per_friend} cookies.")

# Let's calculate the remainder (how many leftover cookies we keep):
leftovers = cookies % friends
print(f"Leftover cookies we get to keep: {leftovers}")

# Raising numbers to a power (2 cubed = 2 * 2 * 2):
two_cubed = 2 ** 3
print(f"2 to the power of 3 is {two_cubed}")

# ==============================================================================
# PART 5: TALKING TO THE COMPUTER (INPUT)
# ==============================================================================
#
# Up until now, the computer has only talked to us. How do we talk to it?
# We use the `input()` function. It pauses the program and waits for you to type.
# Whatever you type gets stored in a variable.
#
# WARNING: The `input()` function ALWAYS saves your answer as a String (text).
# If you want to use it as a number, you have to convert it using `int()` or `float()`.

# UNCOMMENT THE CODE BELOW TO TRY IT INTERACTIVELY:
# user_color = input("What is your favorite color? ")
# print(f"Wow! {user_color} is a beautiful color.")

# user_birth_year = input("What year were you born? ")
# Convert the input (which is text "1999") into a real number 1999:
# age_calc = 2026 - int(user_birth_year)
# print(f"In 2026, you will turn {age_calc} years old!")

# ==============================================================================
# PART 6: PRACTICE QUESTIONS FOR NADIA
# ==============================================================================
#
# Try reading these questions together, write the code underneath, 
# and see if you can get the correct output!

# ------------------------------------------------------------------------------
# QUESTION 1: The Coffee Calculator ☕
# Nadia drinks 2 cups of coffee a day. Each cup costs $3.50.
# 1. Create a variable for the number of cups per day.
# 2. Create a variable for the price per cup.
# 3. Calculate the total cost for 7 days (a week).
# 4. Print a friendly message showing the result: "Nadia spends $XX.XX on coffee per week."
#
# Write your code here:




# ------------------------------------------------------------------------------
# QUESTION 2: The Name Joiner (Concatenation) 🤝
# 1. Create two variables: `first_name` and `last_name`. Put your names in them.
# 2. Create a third variable `full_name` by combining them with a space in between.
#    (Hint: You can add strings together using the `+` sign, e.g. "a" + " " + "b")
# 3. Print your full name in uppercase! 
#    (Hint: If you have a string variable `my_text`, you can do `my_text.upper()` to make it uppercase!)
#
# Write your code here:




# ------------------------------------------------------------------------------
# QUESTION 3: The Odd or Even Checker 🔢
# How do we know if a number is odd or even? If we divide it by 2 and the remainder
# is 0, it's even. If the remainder is 1, it's odd.
# 1. Ask the user for a number using input().
# 2. Convert it to an integer.
# 3. Use the modulo operator `%` to find the remainder when divided by 2.
# 4. Print the remainder. (If it prints 0, the number is even; if 1, it's odd!)
#
# Write your code here:




# ==============================================================================
# SOLUTIONS & ANSWERS (No peeking until you try them! 😉)
# ==============================================================================
#
# --- SOLUTION 1 ---
# cups_per_day = 2
# price_per_cup = 3.50
# weekly_cost = cups_per_day * price_per_cup * 7
# print(f"Nadia spends ${weekly_cost:.2f} on coffee per week.")
#
# --- SOLUTION 2 ---
# first_name = "Nadia"
# last_name = "Smith"
# full_name = first_name + " " + last_name
# print(full_name.upper())
#
# --- SOLUTION 3 ---
# number_input = input("Enter any whole number: ")
# number = int(number_input)
# remainder = number % 2
# print(f"The remainder when divided by 2 is: {remainder}")
